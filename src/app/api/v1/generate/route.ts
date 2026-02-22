import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { openai } from "@/lib/openai";

const RequestSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  days: z.number().int().min(1).max(14),
  userId: z.string().optional(),
});

const ItinerarySchema = z.object({
  title: z.string(),
  days: z.array(
    z.object({
      day_index: z.number(),
      stops: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
        })
      ),
    })
  ),
});

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

async function ensureDemoUser() {
  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: {
      id: DEMO_USER_ID,
      email: "demo@ai-travel-agent.dev",
      name: "Demo User",
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { prompt, days, userId } = parsed.data;
    const resolvedUserId = userId ?? DEMO_USER_ID;

    if (!userId) {
      await ensureDemoUser();
    }

    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    console.log(`[AI] Generating for: ${prompt} (${days} days) model: ${model}`);

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `You are an expert travel planner.
Output strictly valid JSON matching the schema.
Structure the itinerary for ${days} days.
Do NOT invent coordinates, just provide accurate place names.`,
        },
        {
          role: "user",
          content: `Create a trip for: ${prompt}.
Return JSON: { title: string, days: [{ day_index: 0, stops: [{ name, description }] }] }`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const aiContent = completion.choices[0].message.content;
    if (!aiContent) throw new Error("AI returned empty response");

    const parsedAI = ItinerarySchema.safeParse(JSON.parse(aiContent));
    if (!parsedAI.success) {
      throw new Error(`AI response validation failed: ${parsedAI.error.message}`);
    }

    const validatedData = parsedAI.data;

    const newItinerary = await prisma.itinerary.create({
      data: {
        userId: resolvedUserId,
        title: validatedData.title,
        days: validatedData.days,
        config: { pax: "2" },
      },
    });

    return NextResponse.json({
      message: "Itinerary generated",
      id: newItinerary.id,
      data: validatedData,
    });
  } catch (error) {
    console.error("[Generate Error]", error);
    return NextResponse.json(
      { error: "Failed to generate", details: String(error) },
      { status: 500 }
    );
  }
}

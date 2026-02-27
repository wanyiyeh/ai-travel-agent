import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { openai } from "@/lib/openai";
import { ItinerarySchema } from "@/lib/schemas";

const RequestSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  days: z.number().int().min(1).max(14),
  userId: z.string().optional(),
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

function addIdsToItinerary(data: ReturnType<typeof ItinerarySchema.parse>) {
  return {
    ...data,
    days: data.days.map((day) => ({
      ...day,
      id: crypto.randomUUID(),
      stops: day.stops.map((stop, stopIdx) => ({
        ...stop,
        id: crypto.randomUUID(),
        orderIndex: stopIdx,
      })),
    })),
  };
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
    console.log(
      `[AI] Generating for: ${prompt} (${days} days) model: ${model}`
    );

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `你是專業的旅遊規劃專家。Always respond in Traditional Chinese (繁體中文).
Output strictly valid JSON matching this schema for ${days} days:
{ title: string, days: [{ day: number, theme?: string, stops: [{ name: string, description: string, duration_minutes: number }] }] }
day starts from 1. duration_minutes is a number (minutes).`,
        },
        {
          role: "user",
          content: `Create a trip for: ${prompt}.`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const aiContent = completion.choices[0].message.content;
    if (!aiContent) throw new Error("AI returned empty response");

    const parsedAI = ItinerarySchema.safeParse(JSON.parse(aiContent));
    if (!parsedAI.success) {
      throw new Error(
        `AI response validation failed: ${parsedAI.error.message}`
      );
    }

    const validatedData = parsedAI.data;
    const dataWithIds = addIdsToItinerary(validatedData);

    const newItinerary = await prisma.itinerary.create({
      data: {
        userId: resolvedUserId,
        title: validatedData.title,
        days: dataWithIds.days as object[],
        config: {
          generatedWith: prompt,
          totalDays: days,
          createdAt: new Date().toISOString(),
        },
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

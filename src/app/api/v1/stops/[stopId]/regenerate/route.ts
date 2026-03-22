import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { openai } from "@/lib/openai";
import { StopSchema } from "@/lib/schemas";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
  context: z.string().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stopId: string }> }
) {
  try {
    const { stopId } = await params;
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { itineraryId, context } = parsed.data;

    const itinerary = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
    });

    if (!itinerary) {
      return NextResponse.json(
        { error: "Itinerary not found" },
        { status: 404 }
      );
    }

    const days = itinerary.days as Record<string, unknown>[];
    let targetStop: Record<string, unknown> | null = null;
    let targetDayIndex = -1;
    let targetStopIndex = -1;

    for (let i = 0; i < days.length; i++) {
      const stops = days[i].stops as Record<string, unknown>[];
      if (!stops) continue;
      const idx = stops.findIndex((s) => s.id === stopId);
      if (idx >= 0) {
        targetStop = stops[idx];
        targetDayIndex = i;
        targetStopIndex = idx;
        break;
      }
    }

    if (!targetStop) {
      return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    }

    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const tripContext = context ?? itinerary.title;

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `你是專業的旅遊規劃專家。Always respond in Traditional Chinese (繁體中文).
Output strictly valid JSON matching this schema:
{ name: string, description: string, duration_minutes: number }
Suggest a different attraction than the current one for the same trip.`,
        },
        {
          role: "user",
          content: `Trip: ${tripContext}. Current stop: "${targetStop.name}". Suggest a different stop for day ${targetDayIndex + 1}.`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const aiContent = completion.choices[0].message.content;
    if (!aiContent) throw new Error("AI returned empty response");

    const parsedAI = StopSchema.safeParse(JSON.parse(aiContent));
    if (!parsedAI.success) {
      throw new Error(`AI response validation failed: ${parsedAI.error.message}`);
    }

    const newStopData = parsedAI.data;

    const stops = days[targetDayIndex].stops as Record<string, unknown>[];
    stops[targetStopIndex] = {
      ...stops[targetStopIndex],
      name: newStopData.name,
      description: newStopData.description,
      duration_minutes: newStopData.duration_minutes,
      // clear stale geo data since it's a new place
      lat: null,
      lng: null,
      address: null,
      rating: null,
      placeId: null,
    };

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: days as object[] },
    });

    return NextResponse.json({
      name: newStopData.name,
      description: newStopData.description,
      duration_minutes: newStopData.duration_minutes,
    });
  } catch (error) {
    console.error("[Stop Regenerate Error]", error);
    return NextResponse.json(
      { error: "Failed to regenerate", details: String(error) },
      { status: 500 }
    );
  }
}

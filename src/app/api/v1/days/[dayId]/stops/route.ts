import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { openai } from "@/lib/openai";
import { StopCandidateSchema } from "@/lib/schemas";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
  stopName: z.string().min(1),
});

const BatchRequestSchema = z.object({
  itineraryId: z.string().min(1),
  stops: z.array(StopCandidateSchema).min(1),
});

const AIResponseSchema = z.object({
  description: z.string(),
  duration_minutes: z.number().int().positive(),
  estimated_cost: z.number().min(0),
  time_of_day: z.enum(["morning", "afternoon", "evening"]),
  transport_from_prev: z.string(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dayId: string }> }
) {
  try {
    const { dayId } = await params;
    const body = await request.json();

    // Batch path: pre-resolved candidates (from stop-suggestions or another
    // day's already-enriched stops) — no LLM call, write geo fields as-is.
    if (Array.isArray((body as Record<string, unknown>)?.stops)) {
      const parsedBatch = BatchRequestSchema.safeParse(body);
      if (!parsedBatch.success) {
        return NextResponse.json(
          { error: "Invalid request", details: parsedBatch.error.flatten() },
          { status: 400 }
        );
      }

      const { itineraryId, stops: candidates } = parsedBatch.data;

      const itinerary = await prisma.itinerary.findUnique({
        where: { id: itineraryId },
      });
      if (!itinerary) {
        return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
      }

      const days = itinerary.days as Record<string, unknown>[];
      const dayIndex = days.findIndex((d) => d.id === dayId);
      if (dayIndex === -1) {
        return NextResponse.json({ error: "Day not found" }, { status: 404 });
      }

      const stops = (days[dayIndex].stops as Record<string, unknown>[]) ?? [];
      const newStops = candidates.map((c, i) => ({
        id: crypto.randomUUID(),
        name: c.name,
        description: c.description,
        duration_minutes: c.duration_minutes,
        orderIndex: stops.length + i,
        ...(c.placeId
          ? { placeId: c.placeId, lat: c.lat, lng: c.lng, address: c.address, rating: c.rating ?? null }
          : {}),
      }));

      (days[dayIndex].stops as Record<string, unknown>[]).push(...newStops);

      await prisma.itinerary.update({
        where: { id: itineraryId },
        data: { days: j(days) },
      });

      return NextResponse.json({ stops: newStops });
    }

    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { itineraryId, stopName } = parsed.data;

    const itinerary = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
    });

    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const dayIndex = days.findIndex((d) => d.id === dayId);

    if (dayIndex === -1) {
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }

    const day = days[dayIndex];
    const stops = (day.stops as Record<string, unknown>[]) ?? [];
    const prevStop = stops.length > 0 ? stops[stops.length - 1] : null;

    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `你是專業的旅遊規劃專家，用繁體中文回覆。
根據旅行行程與景點名稱，生成該景點的詳細資訊。
回傳嚴格的 JSON 格式（不要其他文字）：
{
  "description": "景點的繁體中文簡介（1-2句）",
  "duration_minutes": 建議停留分鐘數（整數）,
  "estimated_cost": 門票/費用估算（行程貨幣，免費填0）,
  "time_of_day": "morning" | "afternoon" | "evening",
  "transport_from_prev": "從上一個景點前往的交通方式說明"
}`,
        },
        {
          role: "user",
          content: `行程：${itinerary.title}
第 ${day.day as number} 天主題：${(day.theme as string) ?? ""}
貨幣：${(itinerary as unknown as Record<string, unknown>).currency ?? ""}
${prevStop ? `上一個景點：${prevStop.name as string}` : "這是當天第一個景點"}
現有景點：${stops.map((s) => s.name as string).join("、")}

請為「${stopName}」這個景點生成詳細資訊。`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    });

    const aiContent = completion.choices[0].message.content;
    if (!aiContent) throw new Error("AI returned empty response");

    const parsedAI = AIResponseSchema.safeParse(JSON.parse(aiContent));
    if (!parsedAI.success) {
      throw new Error(`AI response validation failed: ${parsedAI.error.message}`);
    }

    const newStop = {
      id: crypto.randomUUID(),
      name: stopName,
      description: parsedAI.data.description,
      duration_minutes: parsedAI.data.duration_minutes,
      estimated_cost: parsedAI.data.estimated_cost,
      time_of_day: parsedAI.data.time_of_day,
      transport_from_prev: parsedAI.data.transport_from_prev,
      orderIndex: stops.length,
    };

    (days[dayIndex].stops as Record<string, unknown>[]).push(newStop);

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ stop: newStop });
  } catch (error) {
    console.error("[Add Stop Error]", error);
    return NextResponse.json(
      { error: "Failed to add stop", details: String(error) },
      { status: 500 }
    );
  }
}

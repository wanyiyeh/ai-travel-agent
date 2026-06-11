import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { openai } from "@/lib/openai";
import { AccommodationSchema } from "@/lib/schemas";
import { getMockMode, mockDelay, MOCK_FIXTURES } from "@/lib/mockAi";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dayId: string }> }
) {
  try {
    const { dayId } = await params;
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { itineraryId } = parsed.data;

    const mockMode = getMockMode();
    if (mockMode === "error") {
      return NextResponse.json({ error: "Mock AI error (MOCK_AI=error)" }, { status: 500 });
    }
    if (mockMode === "slow" || mockMode === "fixture") {
      await mockDelay(mockMode === "slow" ? 3500 : 0);
      const { dayId } = await params;
      const itinerary = await prisma.itinerary.findUnique({ where: { id: itineraryId } });
      if (!itinerary) return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
      const days = itinerary.days as Record<string, unknown>[];
      const dayIndex = days.findIndex((d) => d.id === dayId);
      if (dayIndex === -1) return NextResponse.json({ error: "Day not found" }, { status: 404 });
      days[dayIndex] = { ...days[dayIndex], accommodation: MOCK_FIXTURES.accommodation };
      await prisma.itinerary.update({ where: { id: itineraryId }, data: { days: j(days) } });
      return NextResponse.json({ success: true, accommodation: MOCK_FIXTURES.accommodation });
    }

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
    const currentAccommodation = day.accommodation as Record<string, unknown> | undefined;
    const stops = day.stops as Record<string, unknown>[];
    const dayNumber = day.day as number;

    const stopNames = stops.map((s) => s.name as string).filter(Boolean);
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `你是專業的旅遊規劃專家。根據當天的景點位置，推薦地理位置最合適的真實住宿。
回傳嚴格的 JSON 格式（不要其他文字）：
{ "name": "<住宿名稱，使用原文或英文>", "area": "<所在區域>" }
要求：
- 推薦真實存在且可在 Booking.com 找到的飯店或住宿
- 位置盡量靠近當天景點的地理重心
- 不要重複推薦目前已有的住宿${currentAccommodation ? `（目前住宿：${currentAccommodation.name}）` : ""}`,
        },
        {
          role: "user",
          content: `行程：${itinerary.title}
第 ${dayNumber} 天的景點：${stopNames.join("、")}

請推薦最適合的住宿。`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const aiContent = completion.choices[0].message.content;
    if (!aiContent) throw new Error("AI returned empty response");

    const parsedAI = AccommodationSchema.safeParse(JSON.parse(aiContent));
    if (!parsedAI.success) {
      throw new Error(`AI response validation failed: ${parsedAI.error.message}`);
    }

    const newAccommodation = parsedAI.data;
    days[dayIndex] = { ...day, accommodation: newAccommodation };

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ success: true, accommodation: newAccommodation });
  } catch (error) {
    console.error("[Accommodation Regenerate Error]", error);
    return NextResponse.json(
      { error: "Failed to regenerate accommodation", details: String(error) },
      { status: 500 }
    );
  }
}

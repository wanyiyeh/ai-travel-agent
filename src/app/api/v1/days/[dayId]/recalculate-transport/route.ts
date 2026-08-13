import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { openai } from "@/lib/openai";
import { getDistancesForStopPairs } from "@/lib/distanceMatrix";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
});

const ResponseSchema = z.object({
  stops: z.array(
    z.object({
      id: z.string(),
      transport_from_prev: z.string(),
      time_of_day: z.enum(["morning", "afternoon", "evening"]),
    })
  ),
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
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { itineraryId } = parsed.data;

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
    const stops = day.stops as Record<string, unknown>[];
    const dayNumber = day.day as number;
    const isFirstDay = dayIndex === 0;

    const prevAccommodationObj =
      dayIndex > 0
        ? (days[dayIndex - 1].accommodation as Record<string, unknown> | undefined)
        : undefined;

    const prevAccommodation = prevAccommodationObj
      ? `${prevAccommodationObj.name}（${prevAccommodationObj.area}）`
      : null;

    const originDesc = isFirstDay
      ? "機場（去程航班抵達）"
      : prevAccommodation ?? "前一天住宿";

    // Prepend the previous night's accommodation (when it has coordinates) so the
    // real Google distance for the *first* stop of the day is grounded too —
    // otherwise the first stop's transport is pure AI guesswork.
    const originPoint =
      prevAccommodationObj &&
      typeof prevAccommodationObj.lat === "number" &&
      typeof prevAccommodationObj.lng === "number"
        ? { id: "__origin__", lat: prevAccommodationObj.lat as number, lng: prevAccommodationObj.lng as number }
        : null;

    const distancePoints = [
      ...(originPoint ? [originPoint] : []),
      ...stops.map((s) => ({
        id: s.id as string,
        lat: s.lat as number | null | undefined,
        lng: s.lng as number | null | undefined,
      })),
    ];

    const distanceResults = await getDistancesForStopPairs(distancePoints);
    // When an origin point was prepended, distanceResults[0] is origin->stops[0],
    // so stop i's incoming leg is at distanceResults[i] instead of distanceResults[i-1].
    const distanceOffset = originPoint ? 0 : -1;

    const stopList = stops
      .map((s, i) => {
        const dist = i > 0 || originPoint ? distanceResults[i + distanceOffset] : null;
        const distInfo = dist
          ? `（Google Maps 實際：${dist.distanceText}，開車 ${dist.durationText}）`
          : "";
        return `${i + 1}. ID="${s.id}" 景點名稱：${s.name}${distInfo}`;
      })
      .join("\n");

    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `你是專業的旅遊規劃專家。使用者剛剛調整了行程景點的順序，請根據新的順序重新計算每個景點的交通方式與時段。

規則：
- transport_from_prev：描述從上一個地點前往此景點的交通方式（例如「步行約 10 分鐘」「搭乘地鐵約 20 分鐘」「搭計程車約 15 分鐘」）。第一個景點的出發地為「${originDesc}」。
- time_of_day：根據合理的遊覽順序分配時段，值只能是 "morning"（早上）、"afternoon"（下午）、"evening"（晚上）之一，景點應按順序合理分配到各時段。

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "stops": [
    { "id": "<景點ID>", "transport_from_prev": "<交通說明>", "time_of_day": "<morning|afternoon|evening>" }
  ]
}`,
        },
        {
          role: "user",
          content: `行程：${itinerary.title}
第 ${dayNumber} 天，景點順序如下：
${stopList}

請為每個景點填寫交通方式和時段。`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const aiContent = completion.choices[0].message.content;
    if (!aiContent) throw new Error("AI returned empty response");

    const parsedAI = ResponseSchema.safeParse(JSON.parse(aiContent));
    if (!parsedAI.success) {
      throw new Error(`AI response validation failed: ${parsedAI.error.message}`);
    }

    const updatedFields = parsedAI.data.stops;
    const fieldMap = new Map(updatedFields.map((s) => [s.id, s]));

    days[dayIndex].stops = stops.map((stop) => {
      const updated = fieldMap.get(stop.id as string);
      if (!updated) return stop;
      return {
        ...stop,
        transport_from_prev: updated.transport_from_prev,
        time_of_day: updated.time_of_day,
      };
    });

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ stops: updatedFields });
  } catch (error) {
    console.error("[Recalculate Transport Error]", error);
    return NextResponse.json(
      { error: "Failed to recalculate", details: String(error) },
      { status: 500 }
    );
  }
}

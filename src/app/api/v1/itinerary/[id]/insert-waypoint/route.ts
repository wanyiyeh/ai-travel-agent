import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { TransitRecommendationSchema } from "@/lib/schemas";
import { openai } from "@/lib/openai";

const RequestSchema = z.object({
  recommendation: TransitRecommendationSchema,
  stayDays: z.number().int().min(1).max(14),
});

function calcMaxDays(config: Record<string, unknown>): number | null {
  const flightInfo = config?.flightInfo as { departureDate?: string; returnDate?: string } | undefined;
  if (!flightInfo?.departureDate || !flightInfo?.returnDate) return null;
  const dep = new Date(flightInfo.departureDate);
  const ret = new Date(flightInfo.returnDate);
  return Math.max(1, Math.ceil((ret.getTime() - dep.getTime()) / (1000 * 60 * 60 * 24)));
}

async function generateDayStops(
  cityName: string,
  stayDays: number,
  currency: string
): Promise<Array<Array<Record<string, unknown>>>> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `你是專業的旅遊規劃專家。請為旅行者規劃在 ${cityName} 停留 ${stayDays} 天的景點行程。

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "days": [
    {
      "stops": [
        {
          "name": "景點名稱（繁體中文）",
          "description": "景點描述（繁體中文，1-2 句話）",
          "duration_minutes": 120,
          "time_of_day": "morning",
          "transport_from_prev": "從上一個景點的交通方式描述",
          "estimated_cost": 0
        }
      ]
    }
  ]
}

規則：
- 共生成 ${stayDays} 天，每天 3-4 個景點
- time_of_day 只能是 "morning"、"afternoon"、"evening" 之一，景點合理分配至三個時段
- duration_minutes 為整數（分鐘）
- estimated_cost 為 ${currency} 貨幣的整數，免費景點填 0
- transport_from_prev 描述如何從上一個景點抵達（例：步行約 10 分鐘、搭乘地鐵約 20 分鐘）
- 第一天第一個景點的 transport_from_prev 填寫從飯店或火車站出發的方式
- 所有景點必須是 ${cityName} 真實存在的知名地點`,
      },
      {
        role: "user",
        content: `請規劃 ${cityName} 停留 ${stayDays} 天的景點行程。`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0].message.content;
  if (!content) return Array.from({ length: stayDays }, () => []);

  const parsed = JSON.parse(content) as { days?: Array<{ stops?: unknown[] }> };
  const aiDays = parsed.days ?? [];

  return Array.from({ length: stayDays }, (_, i) => {
    const stops = aiDays[i]?.stops;
    if (!Array.isArray(stops)) return [];
    return stops.map((stop) => ({
      ...(stop as Record<string, unknown>),
      id: crypto.randomUUID(),
    }));
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: itineraryId } = await params;
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { recommendation, stayDays } = parsed.data;

    const itinerary = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
    });

    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const config = (itinerary.config ?? {}) as Record<string, unknown>;
    const maxDays = calcMaxDays(config);
    const currency = (config.currency as string) ?? "EUR";

    const totalInserted = 1 + stayDays;
    const insertAfterIndex = Math.floor(days.length / 2);

    let before = days.slice(0, insertAfterIndex);
    let after = days.slice(insertAfterIndex);

    // If flight dates are fixed, trim before/after proportionally to keep total day count
    if (maxDays !== null) {
      const overflow = days.length + totalInserted - maxDays;
      if (overflow > 0) {
        const totalOther = before.length + after.length;
        let removeFromBefore = Math.round(overflow * before.length / totalOther);
        let removeFromAfter = overflow - removeFromBefore;

        // Keep at least 1 day in each section if possible
        removeFromBefore = Math.min(removeFromBefore, Math.max(0, before.length - 1));
        removeFromAfter = Math.min(removeFromAfter, Math.max(0, after.length - 1));

        // If one side couldn't absorb enough, take the rest from the other
        const absorbed = removeFromBefore + removeFromAfter;
        if (absorbed < overflow) {
          const extra = overflow - absorbed;
          if (after.length - removeFromAfter > 1) {
            removeFromAfter = Math.min(removeFromAfter + extra, after.length - 1);
          } else if (before.length - removeFromBefore > 1) {
            removeFromBefore = Math.min(removeFromBefore + extra, before.length - 1);
          }
        }

        before = before.slice(0, before.length - removeFromBefore);
        after = after.slice(removeFromAfter);
      }
    }

    // Generate stops for new stay days via AI, fall back to empty on failure
    let generatedStops: Array<Array<Record<string, unknown>>>;
    try {
      generatedStops = await generateDayStops(recommendation.name, stayDays, currency);
    } catch (err) {
      console.error("[Insert Waypoint] Stop generation failed, using empty days:", err);
      generatedStops = Array.from({ length: stayDays }, () => []);
    }

    const transitDay: Record<string, unknown> = {
      id: crypto.randomUUID(),
      day: 0,
      theme: `移動日：前往${recommendation.name}`,
      isTransitDay: true,
      transitTo: recommendation.name,
      stops: [],
    };

    const newStayDays: Record<string, unknown>[] = Array.from(
      { length: stayDays },
      (_, i) => ({
        id: crypto.randomUUID(),
        day: 0,
        theme: `${recommendation.name} 探索`,
        stops: generatedStops[i] ?? [],
      })
    );

    // Renumber all days sequentially
    const updatedDays = [...before, transitDay, ...newStayDays, ...after].map(
      (d, i) => ({ ...d, day: i + 1 })
    );

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(updatedDays) },
    });

    const refreshed = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
    });

    return NextResponse.json({
      success: true,
      data: refreshed,
    });
  } catch (error) {
    console.error("[Insert Waypoint Error]", error);
    return NextResponse.json(
      { error: "Failed to insert waypoint", details: String(error) },
      { status: 500 }
    );
  }
}

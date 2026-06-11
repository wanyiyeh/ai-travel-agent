import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { TransitRecommendationSchema } from "@/lib/schemas";
import { openai } from "@/lib/openai";
import { iataToCity } from "@/lib/iataCity";

const ItemSchema = z.object({
  recommendation: TransitRecommendationSchema,
  stayDays: z.number().int().min(1).max(14),
});

const RequestSchema = z.object({
  items: z.array(ItemSchema).min(1).max(8),
  maxDays: z.number().int().min(1).optional(),
  insertAfterDay: z.number().int().min(1).optional(),
});


async function findOptimalInsertionIndex(
  days: Record<string, unknown>[],
  cityNames: string[]
): Promise<{ insertAfterIndex: number; reason: string }> {
  if (days.length <= 1) return { insertAfterIndex: 0, reason: "" };

  const daySummaries = days.map((d, i) => ({
    dayNumber: i + 1,
    theme: d.theme,
    stopCount: Array.isArray(d.stops) ? d.stops.length : 0,
  }));

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a travel planning assistant. Suggest the best day to insert new transit destinations. Respond with valid JSON only.",
        },
        {
          role: "user",
          content: `Current itinerary days: ${JSON.stringify(daySummaries)}
Destinations to insert in order: ${cityNames.join(" → ")}

Choose insertAfterDay between 1 and ${days.length - 1}.
Prefer days with fewer stops (easier transition), avoid splitting the first or last day.

Respond with JSON: { "insertAfterDay": <number>, "reason": "<一句話繁體中文說明>" }`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 150,
    });

    const parsed = JSON.parse(response.choices[0].message.content ?? "{}") as {
      insertAfterDay?: number;
      reason?: string;
    };
    const insertAfterDay = Math.max(
      1,
      Math.min(parsed.insertAfterDay ?? Math.floor(days.length / 2), days.length - 1)
    );
    return { insertAfterIndex: insertAfterDay, reason: parsed.reason ?? "" };
  } catch {
    return { insertAfterIndex: Math.floor(days.length / 2), reason: "" };
  }
}

function getFromCity(
  beforeDays: Record<string, unknown>[],
  config: Record<string, unknown>
): string {
  for (let i = beforeDays.length - 1; i >= 0; i--) {
    const t = beforeDays[i].transitTo;
    if (t && typeof t === "string") return t;
    const wc = beforeDays[i].waypointCity;
    if (wc && typeof wc === "string") return wc;
  }
  const fi = config.flightInfo as { arrivalCity?: string } | undefined;
  return iataToCity(fi?.arrivalCity ?? "");
}

function getNextCity(
  afterDays: Record<string, unknown>[],
  config: Record<string, unknown>
): string | null {
  for (const day of afterDays) {
    if (day.waypointCity && typeof day.waypointCity === "string") return day.waypointCity;
  }
  const fi = config.flightInfo as { returnDepartureCity?: string } | undefined;
  const code = fi?.returnDepartureCity;
  return code ? iataToCity(code) : null;
}

async function generateTransitDayStops(
  fromCity: string,
  toCity: string,
  currency: string
): Promise<Array<Record<string, unknown>>> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `你是專業的旅遊規劃專家。請為旅行者規劃一個從 ${fromCity || "出發地"} 前往 ${toCity} 的移動日行程。

【重要】請先評估兩城市之間的實際地理距離與交通時間，再規劃行程：
- 短程（＜200km，如布拉格→維也納 4hr、巴黎→布魯塞爾 2hr）：抵達後仍有時間下午遊覽
- 中程（200-400km，如維也納→布達佩斯 2.5hr、布拉格→柏林 4.5hr）：抵達後僅能輕鬆逛街或 Check-in
- 長程（＞400km，如布達佩斯→捷克克魯姆洛夫 8-11hr、巴黎→羅馬需過夜）：交通佔全天，抵達已是傍晚甚至深夜，不安排觀光

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "stops": [
    {
      "name": "景點或活動名稱（繁體中文）",
      "description": "描述（繁體中文，1-2 句話）",
      "duration_minutes": 60,
      "time_of_day": "morning",
      "transport_from_prev": "交通方式",
      "estimated_cost": 0
    }
  ]
}

規則：
- 共生成恰好 3 個 stop，依序為：
  1. ${fromCity ? `${fromCity} 出發前早晨微行程（車站附近早餐或快速景點，09:30 前完成，time_of_day: "morning"）` : `出發準備（time_of_day: "morning"）`}
  2. 交通本身（須填入真實交通工具、實際出發/抵達時間、正確車程時數，duration_minutes 必須反映真實車程）
  3. 抵達後活動：
     - 短程抵達（＜15:00）→ 下午遊覽，time_of_day: "afternoon"
     - 中長程抵達（15:00-19:00）→ 僅 Check-in 或附近晚餐，time_of_day: "evening"
     - 長程抵達（＞19:00）→ 休息，time_of_day: "evening"，description 說明已是晚上不宜安排活動
- time_of_day 只能是 "morning"、"afternoon"、"evening" 之一
- duration_minutes 為整數（分鐘），交通 stop 必須填入真實車程分鐘數
- estimated_cost 為 ${currency} 整數，免費填 0
- 所有地點必須真實存在`,
      },
      {
        role: "user",
        content: `請規劃從 ${fromCity || "出發地"} 前往 ${toCity} 的移動日行程。`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0].message.content;
  if (!content) return [];
  const parsed = JSON.parse(content) as { stops?: unknown[] };
  if (!Array.isArray(parsed.stops)) return [];
  return parsed.stops.map((s) => ({
    ...(s as Record<string, unknown>),
    id: crypto.randomUUID(),
  }));
}

async function generateMealsAndAccommodation(
  cityName: string,
  stayDays: number,
  currency: string
): Promise<{ accommodation: Record<string, unknown>; mealsByDay: Array<Record<string, unknown>> }> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `你是專業的旅遊規劃專家。請為旅行者在 ${cityName} 停留 ${stayDays} 天的行程推薦住宿和每日三餐。

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "accommodation": { "name": "住宿名稱（使用原文或英文）", "area": "所在區域" },
  "meals": [
    {
      "breakfast": { "name": "餐廳名稱", "description": "一句話簡介", "estimated_cost": 0 },
      "lunch": { "name": "餐廳名稱", "description": "一句話簡介", "estimated_cost": 0 },
      "dinner": { "name": "餐廳名稱", "description": "一句話簡介", "estimated_cost": 0 }
    }
  ]
}

規則：
- accommodation 為整個在 ${cityName} 停留期間的住宿，必須是真實存在且可在 Booking.com 找到的飯店
- meals 陣列共 ${stayDays} 個元素，每天推薦不同的餐廳
- 所有餐廳必須是 ${cityName} 真實存在的知名店家
- estimated_cost 為 ${currency} 整數，代表每人平均消費`,
      },
      {
        role: "user",
        content: `請為旅行者在 ${cityName} 停留 ${stayDays} 天推薦住宿和每日三餐。`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0].message.content;
  if (!content) return { accommodation: {}, mealsByDay: Array.from({ length: stayDays }, () => ({})) };

  const parsed = JSON.parse(content) as {
    accommodation?: Record<string, unknown>;
    meals?: Array<Record<string, unknown>>;
  };
  return {
    accommodation: parsed.accommodation ?? {},
    mealsByDay: Array.from({ length: stayDays }, (_, i) => parsed.meals?.[i] ?? {}),
  };
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
- time_of_day 只能是 "morning"、"afternoon"、"evening" 之一
- duration_minutes 為整數（分鐘）
- estimated_cost 為 ${currency} 貨幣的整數，免費景點填 0
- transport_from_prev 描述如何從上一個景點抵達
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

    const { items, maxDays, insertAfterDay: userInsertAfterDay } = parsed.data;

    const itinerary = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
    });

    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const config = (itinerary.config ?? {}) as Record<string, unknown>;
    const currency = (config.currency as string) ?? "EUR";

    let insertAfterIndex: number;
    let reason: string;
    if (userInsertAfterDay != null) {
      insertAfterIndex = Math.max(0, Math.min(userInsertAfterDay, days.length - 1));
      reason = "";
    } else {
      const cityNames = items.map((i) => i.recommendation.name);
      ({ insertAfterIndex, reason } = await findOptimalInsertionIndex(days, cityNames));
    }

    // Never insert immediately after a transit day — shift back so the transit day
    // lands in `after` where the update logic can reach it.
    while (insertAfterIndex > 0 && days[insertAfterIndex - 1]?.isTransitDay === true) {
      insertAfterIndex--;
    }

    const before = days.slice(0, insertAfterIndex);
    // Snapshot the unmodified after-block before any trimming or content changes.
    // remove-waypoint uses this to fully restore the original days.
    const originalAfter = days.slice(insertAfterIndex);
    const after = originalAfter;

    // Find the first transit day in `after` to update its departure city,
    // and determine if we need a new return transit day when none exists.
    const lastInsertedCity = items[items.length - 1].recommendation.name;
    const nextTransitDayIndex = after.findIndex((d) => d.isTransitDay === true);
    const nextTransitDay = nextTransitDayIndex >= 0 ? after[nextTransitDayIndex] : null;
    const needsReturnTransit = !nextTransitDay && after.length > 0;
    const returnCity = needsReturnTransit ? getNextCity(after, config) : null;

    // Compute fromCity chain: first item leaves from existing itinerary's last city,
    // each subsequent item leaves from the previous item's destination
    const initialFromCity = getFromCity(before, config);
    const fromCities = items.map((item, idx) =>
      idx === 0 ? initialFromCity : items[idx - 1].recommendation.name
    );

    // Generate all content in parallel: per-city transit/stay/meals, the updated
    // next-transit-day stops (if one exists), and the new return transit (if needed).
    const [allTransitStops, allGeneratedStops, allMealsAndAccommodation, updatedNextTransitStops, returnTransitStops] = await Promise.all([
      Promise.all(
        items.map((item, idx) =>
          generateTransitDayStops(fromCities[idx], item.recommendation.name, currency).catch(
            () => []
          )
        )
      ),
      Promise.all(
        items.map((item) =>
          generateDayStops(item.recommendation.name, item.stayDays, currency).catch(() =>
            Array.from({ length: item.stayDays }, () => [])
          )
        )
      ),
      Promise.all(
        items.map((item) =>
          generateMealsAndAccommodation(item.recommendation.name, item.stayDays, currency).catch(() => ({
            accommodation: {},
            mealsByDay: Array.from({ length: item.stayDays }, () => ({})),
          }))
        )
      ),
      nextTransitDay
        ? generateTransitDayStops(lastInsertedCity, nextTransitDay.transitTo as string, currency).catch(() => null)
        : Promise.resolve(null),
      returnCity
        ? generateTransitDayStops(lastInsertedCity, returnCity, currency).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Build the block to insert: [transitDay + stayDays] per city, in order
    const insertedBlock: Record<string, unknown>[] = [];
    items.forEach((item, idx) => {
      const { accommodation, mealsByDay } = allMealsAndAccommodation[idx];
      const hasAccommodation = Object.keys(accommodation).length > 0;

      insertedBlock.push({
        id: crypto.randomUUID(),
        day: 0,
        theme: `移動日：前往${item.recommendation.name}`,
        isTransitDay: true,
        transitTo: item.recommendation.name,
        stops: allTransitStops[idx],
        // Stash the full original after-block in the first transit day only.
        // remove-waypoint reads this to restore days that were trimmed by maxDays.
        _originalAfter: idx === 0 ? originalAfter : null,
      });
      allGeneratedStops[idx].forEach((stops, dayIdx) => {
        insertedBlock.push({
          id: crypto.randomUUID(),
          day: 0,
          theme: `${item.recommendation.name} 探索`,
          waypointCity: item.recommendation.name,
          stops,
          accommodation: hasAccommodation ? accommodation : undefined,
          meals: mealsByDay[dayIdx] ?? {},
        });
      });
    });
    const updatedAfter =
      nextTransitDay && updatedNextTransitStops && nextTransitDayIndex >= 0
        ? after.map((d, i) =>
            i === nextTransitDayIndex
              ? { ...d, stops: updatedNextTransitStops, theme: `移動日：前往${nextTransitDay.transitTo as string}` }
              : d
          )
        : after;

    const returnTransitDay: Record<string, unknown> | null =
      returnTransitStops && returnCity
        ? {
            id: crypto.randomUUID(),
            day: 0,
            theme: `移動日：前往${returnCity}`,
            isTransitDay: true,
            transitTo: returnCity,
            stops: returnTransitStops,
          }
        : null;

    // Enforce maxDays: trim excess days from after, removing non-transit days first
    // and always preserving the last day (final destination / return day).
    let finalAfter = updatedAfter;
    if (maxDays != null) {
      const returnTransitCount = returnTransitDay ? 1 : 0;
      const overflow = before.length + insertedBlock.length + returnTransitCount + updatedAfter.length - maxDays;
      if (overflow > 0) {
        const candidates = updatedAfter
          .map((d, i) => ({ i, isTransit: d.isTransitDay === true }))
          .filter(({ i }) => i < updatedAfter.length - 1) // never remove last day
          .sort((a, b) => Number(a.isTransit) - Number(b.isTransit)); // non-transit first
        const removeSet = new Set(candidates.slice(0, overflow).map((c) => c.i));
        finalAfter = updatedAfter.filter((_, i) => !removeSet.has(i));
      }
    }

    const allDays = [...before, ...insertedBlock, ...(returnTransitDay ? [returnTransitDay] : []), ...finalAfter];
    // Hard cap: overflow trimming may fall short when updatedAfter has too few removable
    // candidates (e.g. overflow=4 but only 3 non-last days available). Slice to maxDays as
    // a safety net so we never exceed the allowed trip length.
    const cappedDays = maxDays != null ? allDays.slice(0, maxDays) : allDays;
    const updatedDays = cappedDays.map((d, i) => ({
      ...d,
      day: i + 1,
    }));

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(updatedDays) },
    });

    return NextResponse.json({ success: true, insertionReason: reason });
  } catch (error) {
    console.error("[Batch Insert Waypoints Error]", error);
    return NextResponse.json(
      { error: "Failed to batch insert waypoints", details: String(error) },
      { status: 500 }
    );
  }
}

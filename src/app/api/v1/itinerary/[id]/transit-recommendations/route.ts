import { NextResponse } from "next/server";
import { z } from "zod";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { TransitRecommendationSchema } from "@/lib/schemas";
import type { TransitRecommendation } from "@/types/itinerary";
import { getMockMode, mockDelay, MOCK_FIXTURES } from "@/lib/mockAi";

const RequestSchema = z.object({
  originIata: z.string().regex(/^[A-Z]{3}$/),
  destinationIata: z.string().regex(/^[A-Z]{3}$/),
  existingStops: z.array(z.string().min(1)).optional(),
  forceRefresh: z.boolean().optional(),
});

// Airport-pool recs (single-airport "nearby destinations") are shared across every
// trip touching that airport — single-city round trips and each leg of a multi-city
// corridor alike — so they get their own cache, separate from corridor-specific recs.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_MERGED_RECOMMENDATIONS = 8;

const JSON_SCHEMA = `{
  "recommendations": [
    {
      "name": "<目的地名稱（英文）>",
      "type": "<\\"city\\" 或 \\"country\\"，城市填 city，整個國家填 country>",
      "country": "<所屬國家名稱（中文）>",
      "iataCode": "<代表性機場 IATA 代號，若有>",
      "transitTimeHours": <從起點搭火車/巴士/飛機的預估時數，數字>,
      "transitMode": "<主要交通方式，例如：高速火車、巴士、廉航、渡輪>",
      "suggestedStayDaysMin": <建議最少停留天數，整數>,
      "suggestedStayDaysMax": <建議最多停留天數，整數>,
      "popularity": "<high | medium | low>",
      "topAttractions": ["<景點或城市1>", "<景點或城市2>", "<景點或城市3>"],
      "lat": <代表性緯度，數字>,
      "lng": <代表性經度，數字>
    }
  ]
}`;

async function runRecommendationPrompt(systemContent: string, userContent: string): Promise<TransitRecommendation[]> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    temperature: 0.5,
  });

  const aiContent = completion.choices[0].message.content;
  if (!aiContent) throw new Error("AI returned empty response");

  const raw = JSON.parse(aiContent) as { recommendations: unknown[] };
  return raw.recommendations
    .map((item) => TransitRecommendationSchema.safeParse(item))
    .filter((r) => r.success)
    .map((r) => r.data!);
}

function generateAirportPool(iata: string): Promise<TransitRecommendation[]> {
  const systemContent = `你是資深的自助旅行專家。旅行者的行程以 ${iata} 為根據地，請推薦 3 至 5 個從該城市出發值得順遊的周邊目的地，可以是城市或整個國家。

回傳嚴格的 JSON 格式（不要其他文字）：
${JSON_SCHEMA}

推薦標準：
- 優先推薦同一國家內的城市，以火車、巴士等地面交通可合理抵達為原則
- 若推薦其他國家，必須是地理上鄰近且地面交通（火車、渡輪）可直達的目的地；不推薦需另外購買國際機票的跨國城市
- 可以推薦單一城市（type: city），也可以推薦整個值得走訪的國家（type: country）
- 若推薦整個國家，topAttractions 填入該國 3 個最值得走訪的城市或景點
- 優先推薦有完善大眾交通連結的目的地
- 依照受歡迎程度排序（最熱門的排前面）
- topAttractions 必須是 3 個且為真實存在的知名地點`;

  const userContent = `行程根據地：${iata}。\n請推薦從這個城市出發，值得順遊的周邊城市或國家（3 到 5 個）。`;

  return runRecommendationPrompt(systemContent, userContent);
}

function generateCorridorRecommendations(originIata: string, destinationIata: string): Promise<TransitRecommendation[]> {
  const systemContent = `你是資深的自助旅行專家。當旅行者持有「甲地進、乙地出」的機票時，請推薦 3 至 5 個值得順路停留的目的地，可以是城市或整個國家。

回傳嚴格的 JSON 格式（不要其他文字）：
${JSON_SCHEMA}

推薦標準：
- 地理位置在起訖兩點的合理距離內即可，允許適度繞路，不必嚴格落在兩點連線上（例如：從其中一個端點南下或北上 400-500 公里以內、且有直達鐵路／巴士／廉航可抵達的熱門目的地也可推薦，即使方向偏離主線）
- 可以推薦單一城市（type: city），也可以推薦整個值得走訪的國家（type: country）
- 若推薦整個國家，topAttractions 填入該國 3 個最值得走訪的城市或景點
- 優先推薦有完善大眾交通連結的目的地
- 依照受歡迎程度排序（最熱門的排前面）
- topAttractions 必須是 3 個且為真實存在的知名地點`;

  const userContent = `機票資訊：從 ${originIata} 出發，在 ${destinationIata} 結束。\n請推薦這兩個機場之間，值得順路拜訪的城市或國家（3 到 5 個）。`;

  return runRecommendationPrompt(systemContent, userContent);
}

async function getAirportPool(iata: string, forceRefresh: boolean): Promise<TransitRecommendation[]> {
  if (!forceRefresh) {
    const cached = await prisma.airportRecommendationCache.findUnique({ where: { iata } });
    if (cached && Date.now() - cached.updatedAt.getTime() < CACHE_TTL_MS) {
      return JSON.parse(cached.recommendations) as TransitRecommendation[];
    }
  }

  const recommendations = await generateAirportPool(iata);
  await prisma.airportRecommendationCache.upsert({
    where: { iata },
    create: { iata, recommendations: JSON.stringify(recommendations) },
    update: { recommendations: JSON.stringify(recommendations) },
  });
  return recommendations;
}

async function getCorridorRecommendations(
  originIata: string,
  destinationIata: string,
  forceRefresh: boolean
): Promise<TransitRecommendation[]> {
  const where = { originIata_destinationIata: { originIata, destinationIata } };

  if (!forceRefresh) {
    const cached = await prisma.transitRecommendationCache.findUnique({ where });
    if (cached && Date.now() - cached.updatedAt.getTime() < CACHE_TTL_MS) {
      return JSON.parse(cached.recommendations) as TransitRecommendation[];
    }
  }

  const recommendations = await generateCorridorRecommendations(originIata, destinationIata);
  await prisma.transitRecommendationCache.upsert({
    where,
    create: { originIata, destinationIata, recommendations: JSON.stringify(recommendations) },
    update: { recommendations: JSON.stringify(recommendations) },
  });
  return recommendations;
}

// Dedupe by name (case-insensitive), keeping first occurrence — corridor recs take
// priority, then each endpoint's own nearby pool — and cap the combined list.
function mergeUnique(lists: TransitRecommendation[][], max: number): TransitRecommendation[] {
  const seen = new Set<string>();
  const merged: TransitRecommendation[] = [];
  for (const list of lists) {
    for (const rec of list) {
      const key = rec.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(rec);
      if (merged.length >= max) return merged;
    }
  }
  return merged;
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

    const { originIata, destinationIata, existingStops, forceRefresh } = parsed.data;
    const isSingleCity = originIata === destinationIata;

    const mockMode = getMockMode();
    if (mockMode === "error") {
      return NextResponse.json({ error: "Mock AI error (MOCK_AI=error)" }, { status: 500 });
    }
    if (mockMode === "slow" || mockMode === "fixture") {
      await mockDelay(mockMode === "slow" ? 3500 : 0);
      const recs = MOCK_FIXTURES.transitRecommendations.filter(
        (r) => !existingStops?.includes(r.name)
      );
      return NextResponse.json({ recommendations: recs });
    }

    if (isSingleCity) {
      const recommendations = await getAirportPool(originIata, forceRefresh ?? false);
      return NextResponse.json({ recommendations });
    }

    // Multi-city corridor: layer the route-specific stopovers with each endpoint's
    // own nearby-destination pool, so obvious nearby gems (e.g. Kyoto next to KIX)
    // always show up even if the corridor prompt itself didn't surface them.
    const [corridorRecs, originPool, destPool] = await Promise.all([
      getCorridorRecommendations(originIata, destinationIata, forceRefresh ?? false),
      getAirportPool(originIata, false),
      getAirportPool(destinationIata, false),
    ]);

    const recommendations = mergeUnique([corridorRecs, originPool, destPool], MAX_MERGED_RECOMMENDATIONS);

    return NextResponse.json({ recommendations });
  } catch (error) {
    console.error("[Transit Recommendations Error]", error);
    return NextResponse.json(
      { error: "Failed to get transit recommendations", details: String(error) },
      { status: 500 }
    );
  }
}

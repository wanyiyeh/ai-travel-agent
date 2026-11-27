/**
 * Mock AI helper — 在 .env.local 設定 MOCK_AI 來控制 AI 呼叫行為。
 *
 * MOCK_AI=error    → 所有 AI 路由立即回傳 500（測試 F3 fallback/error UI）
 * MOCK_AI=slow     → 等待 3.5 秒後回傳 fixture（測試 loading spinner）
 * MOCK_AI=1        → 立即回傳 fixture，不呼叫真實 API（最快測試）
 *
 * Two layers: a few routes return a fixture before reaching the model
 * (MOCK_FIXTURES below), and the generation pipeline's own calls pass a
 * `mock` reply to generateObject (llm.ts), built here from the call's inputs
 * so the caller's real checks and repair code still run. Anything left
 * unmocked is refused by llm.ts instead of billing.
 */

export type MockMode = "error" | "slow" | "fixture" | null;

export function getMockMode(): MockMode {
  const v = process.env.MOCK_AI;
  if (!v) return null;
  if (v === "error") return "error";
  if (v === "slow") return "slow";
  return "fixture";
}

export async function mockDelay(ms = 3500): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export const MOCK_FIXTURES = {
  accommodation: {
    name: "Mock Hotel Central",
    area: "測試市中心區",
  },

  accommodationCandidates: [
    {
      name: "Mock Hotel Central",
      area: "測試市中心區",
      placeId: "mock-hotel-current",
      lat: 35.01,
      lng: 135.77,
      address: "Mock City, Central St 1",
      rating: 4.3,
      isCurrent: true,
    },
    {
      name: "Mock Hotel Riverside",
      area: "測試河岸區",
      placeId: "mock-hotel-a",
      lat: 35.015,
      lng: 135.775,
      address: "Mock City, Riverside Ave 2",
      rating: 4.6,
    },
    {
      name: "Mock Hostel Downtown",
      area: "測試鬧區",
      placeId: "mock-hotel-b",
      lat: 35.02,
      lng: 135.78,
      address: "Mock City, Downtown Rd 3",
      rating: 4.1,
    },
  ],

  mealCandidates: [
    {
      name: "Mock Current Diner",
      placeId: "mock-meal-current",
      lat: 35.01,
      lng: 135.77,
      address: "Mock City, Central St 1",
      rating: 4.3,
      isCurrent: true,
    },
    {
      name: "Mock Breakfast Cafe",
      placeId: "mock-meal-a",
      lat: 35.015,
      lng: 135.775,
      address: "Mock City, Riverside Ave 2",
      rating: 4.6,
    },
    {
      name: "Mock Local Eatery",
      placeId: "mock-meal-b",
      lat: 35.02,
      lng: 135.78,
      address: "Mock City, Downtown Rd 3",
      rating: 4.1,
    },
  ],

  transitRecommendations: [
    {
      name: "Budapest",
      type: "city" as const,
      country: "匈牙利",
      iataCode: "BUD",
      transitTimeHours: 2.5,
      transitMode: "高速火車",
      suggestedStayDaysMin: 2,
      suggestedStayDaysMax: 4,
      popularity: "high" as const,
      topAttractions: ["布達城堡", "塞切尼浴場", "英雄廣場"],
      lat: 47.4979,
      lng: 19.0402,
    },
    {
      name: "Bratislava",
      type: "city" as const,
      country: "斯洛伐克",
      iataCode: "BTS",
      transitTimeHours: 1.0,
      transitMode: "火車",
      suggestedStayDaysMin: 1,
      suggestedStayDaysMax: 2,
      popularity: "medium" as const,
      topAttractions: ["布拉提斯拉瓦城堡", "老城區", "UFO觀景橋"],
      lat: 48.1486,
      lng: 17.1077,
    },
    {
      name: "Prague",
      type: "city" as const,
      country: "捷克",
      iataCode: "PRG",
      transitTimeHours: 4.5,
      transitMode: "火車",
      suggestedStayDaysMin: 3,
      suggestedStayDaysMax: 5,
      popularity: "high" as const,
      topAttractions: ["布拉格城堡", "查理大橋", "老城廣場天文鐘"],
      lat: 50.0755,
      lng: 14.4378,
    },
  ],

  stopCandidates: [
    {
      name: "Mock 候選景點 A",
      description: "這是 MOCK_AI 模式下產生的模擬候選景點 A。",
      duration_minutes: 90,
      placeId: "mock-place-a",
      lat: 35.01,
      lng: 135.77,
      address: "Mock City, Mock St 1",
      rating: 4.5,
    },
    {
      name: "Mock 候選景點 B",
      description: "這是 MOCK_AI 模式下產生的模擬候選景點 B。",
      duration_minutes: 60,
      placeId: "mock-place-b",
      lat: 35.02,
      lng: 135.78,
      address: "Mock City, Mock St 2",
      rating: 4.2,
    },
    {
      name: "Mock 候選景點 C",
      description: "這是 MOCK_AI 模式下產生的模擬候選景點 C。",
      duration_minutes: 120,
      placeId: "mock-place-c",
      lat: 35.03,
      lng: 135.79,
      address: "Mock City, Mock St 3",
      rating: 4.8,
    },
  ],
};

const MOCK_NOTE = "（模擬）";

/** planTrip: the arrival city, any city a 固定行程 needs, then the return city. */
export function mockTripPlanReply(input: {
  arrivalCity: string;
  returnCity: string;
  requiredCities: string[];
  daysToAllocate: number;
  currency: string;
}) {
  const names = [...new Set([input.arrivalCity, ...input.requiredCities, input.returnCity])].slice(
    0,
    Math.max(1, input.daysToAllocate),
  );
  const base = Math.floor(input.daysToAllocate / names.length);
  const extra = input.daysToAllocate % names.length;
  return {
    title: `${input.arrivalCity} ${input.daysToAllocate + 1} 天${MOCK_NOTE}`,
    currency: input.currency,
    cities: names.map((name, i) => ({ name, days: base + (i < extra ? 1 : 0) })),
  };
}

const mockStop = (name: string, time_of_day: "morning" | "afternoon" | "evening", duration_minutes = 60) => ({
  name,
  description: `${name}${MOCK_NOTE}`,
  duration_minutes,
  time_of_day,
  transport_from_prev: "步行約 10 分鐘",
  estimated_cost: 0,
});

/** planTransitDay: a two-hour ride, arriving early afternoon. */
export function mockTransitPlanReply(fromCity: string, toCity: string) {
  return {
    transitStop: { ...mockStop(`從 ${fromCity || "出發地"} 前往 ${toCity}`, "morning", 120), transport_from_prev: "搭乘電車約 2 小時" },
    arrivalTime: "13:00",
  };
}

/** generateTransitDayStopsWithLLM (the fallback): the ride and one stop on arrival. */
export function mockTransitDayStopsReply(fromCity: string, toCity: string) {
  return {
    stops: [
      { ...mockStop(`從 ${fromCity || "出發地"} 前往 ${toCity}`, "morning", 120), transport_from_prev: "搭乘電車約 2 小時" },
      mockStop(`${toCity} 模擬景點`, "afternoon"),
    ],
  };
}

/** generateDayStopsWithLLM (the fallback): three stops a day. */
export function mockDayStopsReply(cityName: string, stayDays: number) {
  return {
    days: Array.from({ length: stayDays }, (_, d) => ({
      stops: (["morning", "afternoon", "evening"] as const).map((slot, i) =>
        mockStop(`${cityName} 模擬景點 ${d + 1}-${i + 1}`, slot),
      ),
    })),
  };
}

/** askMealsAndLodging: invented names, as for a city with no candidates. */
export function mockMealsAndLodgingReply(cityName: string, stayDays: number) {
  const meal = (label: string) => ({ name: `${cityName} 模擬${label}`, description: `模擬${label}${MOCK_NOTE}`, estimated_cost: 0 });
  return {
    accommodation: { name: `${cityName} 模擬住宿`, area: `${cityName} 市中心` },
    meals: Array.from({ length: stayDays }, () => ({
      breakfast: meal("早餐"),
      lunch: meal("午餐"),
      dinner: meal("晚餐"),
      snack: meal("點心"),
    })),
  };
}

// The chat assistant (src/lib/chat/assistant.ts). Classification goes by
// keyword so dev:free can reach every class; replies point at day 1.
type ChatMockCategory = "itinerary_question" | "edit" | "restructure" | "place_fact" | "travel_knowledge" | "off_topic";

const CHAT_MOCK_KEYWORDS: [ChatMockCategory, RegExp][] = [
  ["off_topic", /程式|code|作業|股票/i],
  ["travel_knowledge", /小費|簽證|習俗|插座/],
  ["place_fact", /幾點開|營業|地址|評價|門票/],
  ["restructure", /多待|少待|天數|加一個城市|城市/],
  ["edit", /刪|換|移到|加一個|加回|不要|想吃/],
];

const MOCK_MEAL_WORDS: [string, string][] = [
  ["早餐", "breakfast"],
  ["午餐", "lunch"],
  ["晚餐", "dinner"],
  ["點心", "snack"],
];

// Day 1, read from the words: a meal or the hotel or a stop; swap, remove,
// restore, move or add. Rough, but enough for dev:free to show every card.
function mockEditReply(message: string, days: unknown) {
  const firstDay = Array.isArray(days) ? (days[0] as { stops?: unknown[] } | undefined) : undefined;
  const stopCount = Array.isArray(firstDay?.stops) ? firstDay.stops.length : 0;
  const meal = MOCK_MEAL_WORDS.find(([word]) => message.includes(word));
  const wanted = /(?:想吃|換成)([^，。！？,.!?\s]{1,20})/.exec(message)?.[1] ?? null;
  const said = (text: string, actions: unknown[]) => ({ reply: `${text}確認後才會修改。${MOCK_NOTE}`, actions });

  if (meal) {
    const [word, mealType] = meal;
    if (/加回/.test(message)) return said(`建議加回第1天的${word}，`, [{ action: "restore_meal", dayNumber: 1, mealType }]);
    if (/刪|不要/.test(message)) return said(`建議刪除第1天的${word}，`, [{ action: "remove_meal", dayNumber: 1, mealType }]);
    return said(`建議換掉第1天的${word}${wanted ? `，找「${wanted}」` : ""}，`, [
      { action: "replace_meal", dayNumber: 1, mealType, request: wanted },
    ]);
  }
  if (/住宿|飯店|旅館/.test(message)) return said("建議換掉第1天的住宿，", [{ action: "replace_accommodation", dayNumber: 1 }]);
  if (/加一個|加景點|太空/.test(message)) return said("建議為第1天加景點，", [{ action: "suggest_stops", dayNumber: 1, request: null }]);
  if (stopCount === 0) return { reply: `第1天沒有景點可以修改。${MOCK_NOTE}`, actions: [] };
  if (/移到|移/.test(message) && stopCount >= 2) {
    return said("建議把第1天第1站移到第2站，", [{ action: "move_stop", dayNumber: 1, stopNumber: 1, toPosition: 2 }]);
  }
  if (/換/.test(message)) return said("建議換掉第1天第1站，", [{ action: "replace_stop", dayNumber: 1, stopNumber: 1 }]);
  return said("建議刪除第1天第1站，", [{ action: "remove_stop", dayNumber: 1, stopNumber: 1 }]);
}

export function mockChatClassification(message: string) {
  const hit = CHAT_MOCK_KEYWORDS.find(([, pattern]) => pattern.test(message));
  return { category: hit ? hit[0] : "itinerary_question", confident: true };
}

export function mockChatReply(category: string, days: unknown, cities: string[], message = "") {
  const firstDay = Array.isArray(days) ? (days[0] as { stops?: unknown[] } | undefined) : undefined;
  const hasStop = Array.isArray(firstDay?.stops) && firstDay.stops.length > 0;
  switch (category) {
    case "edit":
      return mockEditReply(message, days);
    case "restructure":
      return {
        reply: `第一個城市多待一天，確認後被調整的天會重新產生。${MOCK_NOTE}`,
        cities: cities.length ? cities.map((name, i) => ({ name, days: i === 0 ? 3 : 2, isNew: false })) : null,
      };
    case "place_fact":
      return { reply: `請點「照片與詳情」查看。${MOCK_NOTE}`, places: hasStop ? [{ dayNumber: 1, stopNumber: 1 }] : [] };
    default:
      return { reply: `第1天的安排如行程所列。${MOCK_NOTE}`, transportCards: [] };
  }
}

/**
 * Mock AI helper — 在 .env.local 設定 MOCK_AI 來控制 AI 呼叫行為。
 *
 * MOCK_AI=error    → 所有 AI 路由立即回傳 500（測試 F3 fallback/error UI）
 * MOCK_AI=slow     → 等待 3.5 秒後回傳 fixture（測試 loading spinner）
 * MOCK_AI=1        → 立即回傳 fixture，不呼叫真實 API（最快測試）
 *
 * Two layers: a few routes return a fixture before reaching the model
 * (MOCK_FIXTURES below), and the generation pipeline's own calls go through
 * mockCompletion(), which hands back a reply built from the call's inputs so
 * the caller's real parsing and repair code still runs. Anything left
 * unmocked is refused by the client in openai.ts instead of billing.
 */

import type OpenAI from "openai";
import type { RestaurantHint } from "@/lib/fetchCityRestaurants";
import type { MealLodgingPools } from "@/lib/mealLodgingPicks";
import type { SkeletonStop } from "@/lib/scheduler/buildDaySkeleton";

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

/**
 * Stands in for one chat completion while MOCK_AI is set: null otherwise, so
 * a call site reads `(await mockCompletion(...)) ?? (await openai...create(...))`
 * and its parsing below runs on either. "error" throws like a failed request.
 */
export async function mockCompletion(reply: () => unknown): Promise<OpenAI.Chat.Completions.ChatCompletion | null> {
  const mode = getMockMode();
  if (!mode) return null;
  if (mode === "slow") await mockDelay();
  if (mode === "error") throw new Error("Mock AI error (MOCK_AI=error)");
  return {
    id: "mock-completion",
    object: "chat.completion",
    created: 0,
    model: "mock",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        logprobs: null,
        message: { role: "assistant", content: JSON.stringify(reply()), refusal: null },
      },
    ],
  };
}

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

/** generateSkeletonCopy: one line per skeleton stop, keyed by its id. */
export function mockSkeletonCopyReply(skeleton: SkeletonStop[], hintById: Map<string, RestaurantHint>) {
  return {
    dayTheme: `模擬主題日${MOCK_NOTE}`,
    stops: Object.fromEntries(
      skeleton.map((s) => [s.id, { description: `${hintById.get(s.id)?.name ?? s.id} 的模擬介紹。` }]),
    ),
  };
}

/** fillMissingCopy: one line per numbered target. */
export function mockMissingCopyReply(names: string[]) {
  return { copy: Object.fromEntries(names.map((name, i) => [String(i), `${name} 的模擬介紹`])) };
}

/** translatePlaceNames: the same names back, in order. */
export function mockTranslatedNamesReply(names: string[]) {
  return { names };
}

const mockStop = (name: string, time_of_day: "morning" | "afternoon" | "evening", duration_minutes = 60) => ({
  name,
  description: `${name}${MOCK_NOTE}`,
  duration_minutes,
  time_of_day,
  transport_from_prev: "步行約 10 分鐘",
  estimated_cost: 0,
});

/** planTransitDay: no prep stops, a two-hour ride, arriving early afternoon. */
export function mockTransitPlanReply(fromCity: string, toCity: string) {
  return {
    prepStops: [],
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

/**
 * askMealsAndLodging: picks candidates by id in list order (applyMealPicks
 * swaps out any repeat), or invents names when there are no pools.
 */
export function mockMealsAndLodgingReply(cityName: string, stayDays: number, pools: MealLodgingPools | null, askLodging: boolean) {
  const pick = (prefix: string, list: unknown[] | undefined, day: number, offset = 0) =>
    list && list.length > 0 ? `${prefix}${((day + offset) % list.length) + 1}` : null;
  const meal = (label: string, id: string | null) => ({
    ...(pools ? { id } : {}),
    name: `${cityName} 模擬${label}`,
    description: `模擬${label}${MOCK_NOTE}`,
    estimated_cost: 0,
  });
  return {
    accommodation: askLodging
      ? { ...(pools ? { id: pick("H", pools.lodging, 0) } : {}), name: `${cityName} 模擬住宿`, area: `${cityName} 市中心` }
      : {},
    meals: Array.from({ length: stayDays }, (_, d) => ({
      breakfast: meal("早餐", pick("B", pools?.breakfast, d)),
      lunch: meal("午餐", pick("M", pools?.main, d * 2)),
      dinner: meal("晚餐", pick("M", pools?.main, d * 2, 1)),
      snack: meal("點心", pick("S", pools?.snack, d)),
      ...(pools && pools.nightcap.length > 0 ? { nightcap: meal("小酌", pick("N", pools.nightcap, d)) } : {}),
    })),
  };
}

/** The destination's currency for a mock plan, from its country. */
export function mockCurrencyFor(countryZh: string | undefined): string {
  const byCountry: Record<string, string> = { 日本: "JPY", 台灣: "TWD", 韓國: "KRW", 泰國: "THB", 香港: "HKD", 新加坡: "SGD" };
  return (countryZh && byCountry[countryZh]) || "USD";
}

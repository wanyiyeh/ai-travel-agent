/**
 * Mock AI helper — 在 .env.local 設定 MOCK_AI 來控制 AI 呼叫行為。
 *
 * MOCK_AI=error    → 所有 AI 路由立即回傳 500（測試 F3 fallback/error UI）
 * MOCK_AI=slow     → 等待 3.5 秒後回傳 fixture（測試 loading spinner）
 * MOCK_AI=1        → 立即回傳 fixture，不呼叫真實 API（最快測試）
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

  stop: {
    name: "Mock 測試景點",
    description: "這是 MOCK_AI 模式下產生的模擬景點，用於測試 UI 行為。",
    duration_minutes: 90,
    time_of_day: "afternoon" as const,
    transport_from_prev: "步行約10分鐘",
    estimated_cost: 0,
  },
};

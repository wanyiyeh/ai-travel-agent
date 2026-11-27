import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Under MOCK_AI (dev:free) the real llm.ts answers with mockAi.ts's chat
// replies, checked against the same schemas: every class must get through.
vi.mock("@/lib/db", () => ({ prisma: {}, j: (v: unknown) => v }));

const { answerChatMessage } = await import("@/lib/chat/assistant");

const days = [
  { id: "d1", waypointCity: "東京", stops: [{ id: "s1", duration_minutes: 60 }], meals: { lunch: { placeId: "m1" } }, skippedMeals: ["snack"] },
  { id: "d2", waypointCity: "京都", stops: [] },
];

beforeAll(() => vi.stubEnv("MOCK_AI", "1"));
afterAll(() => vi.unstubAllEnvs());

describe("chat assistant under MOCK_AI", () => {
  it.each([
    ["第一天做什麼", "itinerary_question"],
    ["刪掉第一站", "edit"],
    ["京都多待一天", "restructure"],
    ["幾點開", "place_fact"],
    ["要給小費嗎", "travel_knowledge"],
    ["幫我寫程式", "off_topic"],
  ])("%s → %s", async (message, category) => {
    const answer = await answerChatMessage({ message, days, departureDate: "2026-12-01", history: [], shownNames: [] });
    expect(answer.category).toBe(category);
    expect(answer.reply).not.toBe("");
  });

  it("proposes a change the trip has", async () => {
    const answer = await answerChatMessage({ message: "刪掉第一站", days, departureDate: "", history: [], shownNames: [] });
    expect(answer.proposals).toEqual([{ action: "remove_stop", params: { dayId: "d1", stopId: "s1", at: "第1天第1站" } }]);
  });

  // dev:free reads the words roughly, so every kind of card can be tried.
  it.each([
    ["午餐想吃拉麵", { action: "replace_meal", params: { dayId: "d1", mealType: "lunch", request: "拉麵" } }],
    ["刪掉午餐", { action: "remove_meal", params: { dayId: "d1", mealType: "lunch" } }],
    ["加回點心", { action: "restore_meal", params: { dayId: "d1", mealType: "snack" } }],
    ["換掉第一站", { action: "replace_stop", params: { dayId: "d1", stopId: "s1", at: "第1天第1站" } }],
    ["第一天加一個景點", { action: "suggest_stops", params: { dayId: "d1", request: null } }],
  ])("%s", async (message, proposal) => {
    const answer = await answerChatMessage({ message, days, departureDate: "", history: [], shownNames: [] });
    expect(answer.proposals).toEqual([proposal]);
  });
});

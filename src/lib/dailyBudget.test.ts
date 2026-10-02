import { afterEach, describe, expect, it, vi } from "vitest";
import { DAILY_CALL_BUDGET, budgetExhaustedResponse, consumeDailyBudget, resetDailyBudgetForTests } from "./dailyBudget";
import { googleFetch } from "./googleFetch";

afterEach(() => {
  resetDailyBudgetForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("consumeDailyBudget", () => {
  const day1 = Date.UTC(2026, 9, 2, 12);
  const day2 = Date.UTC(2026, 9, 3, 0, 0, 1);

  it("refuses once the day's budget is used, and resets the next UTC day", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < DAILY_CALL_BUDGET.openai; i++) {
      expect(consumeDailyBudget("openai", day1)).toBe(true);
    }
    expect(consumeDailyBudget("openai", day1)).toBe(false);
    expect(consumeDailyBudget("google", day1)).toBe(true);
    expect(consumeDailyBudget("openai", day2)).toBe(true);
  });

  it("tells the OpenAI SDK not to retry the synthetic 429", () => {
    const res = budgetExhaustedResponse("openai");
    expect(res.status).toBe(429);
    expect(res.headers.get("x-should-retry")).toBe("false");
  });
});

describe("googleFetch daily budget", () => {
  it("stops calling Google once the budget is used up", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    for (let i = 0; i < DAILY_CALL_BUDGET.google; i++) consumeDailyBudget("google");

    const res = await googleFetch("https://places.googleapis.com/v1/places:searchText", { method: "POST" });
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { DAILY_CALL_BUDGET, budgetExhaustedResponse, createMemoryDailyBudget } from "./dailyBudget";
import { googleFetch } from "./googleFetch";
import { consumeDailyBudget, resetDailyBudgetForTests } from "./sharedState";
import { describeDailyBudget } from "@tests/contracts/sharedState";

afterEach(() => {
  resetDailyBudgetForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describeDailyBudget("memory", (limits) => createMemoryDailyBudget(limits));

describe("budgetExhaustedResponse", () => {
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
    for (let i = 0; i < DAILY_CALL_BUDGET.google; i++) await consumeDailyBudget("google");

    const res = await googleFetch("https://places.googleapis.com/v1/places:searchText", { method: "POST" });
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

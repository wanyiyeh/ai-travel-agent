import { describe, expect, it } from "vitest";
import { estimateFromPriceRange, mainMealBudgetFit, rankMainMealsByBudget } from "./mealBudget";

// NT$ per unit; JPY ≈ 0.2 keeps the arithmetic readable.
const rates = { TWD: 1, JPY: 0.2 };
const yen = (start?: number, end?: number) => ({ priceRange: { currency: "JPY", start, end }, priceLevel: null });

describe("mainMealBudgetFit", () => {
  it("budget/moderate: fits when the whole range is under the cap", () => {
    // ¥1,500-2,000 = NT$300-400
    expect(mainMealBudgetFit(yen(1500, 2000), "budget", "JPY", rates)).toBe("fit");
    // ¥1,500-2,500 = NT$300-500: the top end is over NT$400
    expect(mainMealBudgetFit(yen(1500, 2500), "budget", "JPY", rates)).toBe("outside");
    expect(mainMealBudgetFit(yen(1500, 2500), "moderate", "JPY", rates)).toBe("fit");
  });

  it("luxury: fits when the range overlaps NT$1,000-2,000", () => {
    expect(mainMealBudgetFit(yen(6000, 8000), "luxury", "JPY", rates)).toBe("fit"); // NT$1,200-1,600
    expect(mainMealBudgetFit(yen(1000, 2000), "luxury", "JPY", rates)).toBe("outside"); // too cheap
    expect(mainMealBudgetFit(yen(15000, 20000), "luxury", "JPY", rates)).toBe("outside"); // too expensive
  });

  it("treats an open-ended range ('¥10,000+') as unbounded above", () => {
    expect(mainMealBudgetFit(yen(10000), "moderate", "JPY", rates)).toBe("outside");
    expect(mainMealBudgetFit(yen(8000), "luxury", "JPY", rates)).toBe("fit"); // NT$1,600+
  });

  it("falls back to the priceLevel cost estimate when there's no range", () => {
    // JPY dinner table: level 1 → ¥2,000 = NT$400
    expect(mainMealBudgetFit({ priceRange: null, priceLevel: 1 }, "budget", "JPY", rates)).toBe("fit");
    expect(mainMealBudgetFit({ priceRange: null, priceLevel: 3 }, "budget", "JPY", rates)).toBe("outside");
  });

  it("falls back to priceLevel alone when there's no exchange rate", () => {
    const noRates = { TWD: 1 };
    expect(mainMealBudgetFit(yen(1500, 2000), "luxury", "JPY", noRates)).toBe("unknown");
    expect(mainMealBudgetFit({ priceRange: null, priceLevel: 3 }, "luxury", "JPY", noRates)).toBe("fit");
    expect(mainMealBudgetFit({ priceRange: null, priceLevel: 1 }, "luxury", "JPY", noRates)).toBe("outside");
  });

  it("is unknown with no price data at all", () => {
    expect(mainMealBudgetFit({ priceRange: null, priceLevel: null }, "moderate", "JPY", rates)).toBe("unknown");
  });
});

describe("rankMainMealsByBudget", () => {
  const places = [
    { name: "over", ...yen(9000, 12000) },
    { name: "unknown", priceRange: null, priceLevel: null },
    { name: "fit", ...yen(800, 1500) },
  ];

  it("orders fitting, then unknown, then outside", () => {
    const ranked = rankMainMealsByBudget(places, "budget", "JPY", rates, 3);
    expect(ranked.map((p) => p.name)).toEqual(["fit", "unknown", "over"]);
  });

  it("drops outside-budget places when the rest already cover the meals needed", () => {
    const ranked = rankMainMealsByBudget(places, "budget", "JPY", rates, 2);
    expect(ranked.map((p) => p.name)).toEqual(["fit", "unknown"]);
  });

  it("leaves the order alone when no budget was chosen", () => {
    expect(rankMainMealsByBudget(places, undefined, "JPY", rates, 2)).toBe(places);
  });
});

describe("estimateFromPriceRange", () => {
  it("uses the midpoint, or the floor of an open-ended range", () => {
    expect(estimateFromPriceRange({ currency: "JPY", start: 1000, end: 2000 }, "JPY")).toBe(1500);
    expect(estimateFromPriceRange({ currency: "JPY", start: 3000 }, "JPY")).toBe(3000);
  });

  it("gives nothing when the range is in another currency", () => {
    expect(estimateFromPriceRange({ currency: "USD", start: 10, end: 20 }, "JPY")).toBeUndefined();
  });
});

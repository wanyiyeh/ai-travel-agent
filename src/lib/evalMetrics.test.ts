import { describe, expect, it } from "vitest";
import { measureItinerary, type EvalContext } from "./evalMetrics";

const ctx: EvalContext = {
  placeTypes: new Map([
    ["museum1", ["museum"]],
    ["park1", ["park"]],
    ["veg", ["vegetarian_restaurant"]],
    ["sushi", ["sushi_restaurant"]],
    ["ramen", ["ramen_restaurant"]],
    ["hostel", ["hostel", "lodging"]],
  ]),
  twdPerUnit: { JPY: 0.2 },
  currency: "JPY",
  budget: "budget", // NT$0-400
};

const meal = (placeId: string | undefined, cost?: number) => ({ name: placeId ?? "Invented", placeId, estimated_cost: cost });

// Day 1-2 sightseeing, day 3 a transit day, day 4 the return day.
const days = [
  {
    waypointCity: "東京",
    stops: [
      { placeId: "museum1", duration_minutes: 180 },
      { placeId: "park1", duration_minutes: 120 },
    ],
    meals: { breakfast: meal("cafe"), lunch: meal("ramen", 1500), snack: meal("cafe2"), dinner: meal("veg", 2500) },
    accommodation: { name: "Backpackers", placeId: "hostel" },
  },
  {
    waypointCity: "東京",
    stops: [],
    meals: { breakfast: meal("cafe"), lunch: meal("ramen", 1800), snack: meal(undefined), dinner: meal("sushi", 4000) },
    accommodation: { name: "Backpackers", placeId: "hostel" },
  },
  {
    waypointCity: "東京",
    isTransitDay: true,
    transitTo: "大阪",
    stops: [{ placeId: "museum1", duration_minutes: 60 }],
    meals: { lunch: meal("ramen", 1500) },
    accommodation: { name: "Hilton Osaka" },
  },
  { waypointCity: "大阪", stops: [], meals: {}, accommodation: null },
];

describe("measureItinerary", () => {
  const m = measureItinerary(days, ctx);

  it("counts stops and stays over sightseeing days only (not transit or return days)", () => {
    expect(m.sightseeingDays).toBe(2);
    expect(m.stopsPerDay).toBe(1);
    expect(m.avgStayMinutes).toBe(150);
    expect(m.emptySightseeingDays).toBe(1);
    expect(m.categoryShare).toEqual({ museum: 0.5, park: 0.5 });
  });

  it("measures lunch/dinner price against the budget in NT$", () => {
    // ¥1,500/1,800/2,500/4,000/1,500 → NT$300/360/500/800/300: three inside NT$0-400
    expect(m.mainMeals).toBe(5);
    expect(m.mainMealsWithinBudget).toBeCloseTo(3 / 5);
    expect(m.avgMainMealTwd).toBeCloseTo(452);
  });

  it("counts vegetarian and meat/seafood meals by primary type", () => {
    expect(m.vegetarianShare).toBeCloseTo(1 / 5);
    expect(m.meatOrSeafoodMeals).toBe(1);
  });

  it("flags repeats on adjacent days, invented names and days short of meals", () => {
    // cafe again on day 2 (1), ramen again on days 2 and 3 (2) → 3 adjacent repeats
    expect(m.adjacentRepeats).toBe(3);
    expect(m.inventedMeals).toBe(1);
    expect(m.daysMissingMeals).toBe(1); // the transit day has 1 of 3
  });

  it("classifies each lodging once", () => {
    expect(m.lodging).toEqual([
      { name: "Backpackers", hostel: true, luxury: false },
      { name: "Hilton Osaka", hostel: false, luxury: true },
    ]);
  });

  it("lists cities in order", () => {
    expect(m.cities).toEqual(["東京", "大阪"]);
  });

  it("leaves budget fit empty when no budget was chosen", () => {
    expect(measureItinerary(days, { ...ctx, budget: undefined }).mainMealsWithinBudget).toBeNull();
  });
});

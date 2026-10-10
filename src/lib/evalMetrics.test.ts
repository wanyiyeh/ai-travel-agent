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
      { name: "Backpackers", budgetTier: true, luxury: false },
      { name: "Hilton Osaka", budgetTier: false, luxury: true },
    ]);
  });

  it("lists cities in order", () => {
    expect(m.cities).toEqual(["東京", "大阪"]);
  });

  it("counts the nights in each city, the transit day's in the city it goes to", () => {
    expect(m.nightStays).toEqual([
      { city: "東京", nights: 2 },
      { city: "大阪", nights: 1 },
    ]);
  });

  it("lists where each fixed event ended up", () => {
    const withEvents = days.map((d, i) =>
      i === 0
        ? {
            ...d,
            stops: [...d.stops, { name: "東京巨蛋", fixedEvent: { type: "concert" } }],
            meals: { ...d.meals, lunch: { name: "叙々苑", fixedEvent: { type: "reservation" } } },
          }
        : d
    );
    expect(measureItinerary(withEvents, ctx).fixedEvents).toEqual([
      { day: 1, name: "東京巨蛋", as: "stop", lastStop: true, city: "東京" },
      { day: 1, name: "叙々苑", as: "lunch" },
    ]);
  });

  it("measures how far the day's dinner is from an event", () => {
    const concertDay = days.map((d, i) =>
      i === 0
        ? {
            ...d,
            stops: [{ name: "東京巨蛋", lat: 35.7056, lng: 139.7519, fixedEvent: { type: "concert" } }],
            meals: { ...d.meals, dinner: { name: "Near", lat: 35.7056, lng: 139.7629 } },
          }
        : d
    );
    // 0.011 degrees of longitude at 35.7N is about 1km.
    expect(measureItinerary(concertDay, ctx).fixedEvents[0].dinnerKm).toBe(1);
  });

  it("counts legs by how they're travelled, and names the trip's first and last stop", () => {
    const withLegs = days.map((d, i) =>
      i === 0
        ? { ...d, stops: [{ ...d.stops[0], name: "機場取車" }, { ...d.stops[1], transport_from_prev: "開車約 20 分鐘" }] }
        : d
    );
    const m2 = measureItinerary(withLegs, ctx);
    expect(m2.legModes.drive).toBe(1);
    expect(m2.tripEnds.first).toBe("機場取車");
  });

  it("lists the seasonal days with their stops", () => {
    const stops = [{ name: "新宿御苑" }, { name: "千鳥淵", time_of_day: "evening" }];
    const withSeason = days.map((d, i) => (i === 1 ? { ...d, theme: "東京 季節限定：賞櫻", stops } : d));
    expect(measureItinerary(withSeason, ctx).seasonalDays).toEqual([
      { day: 2, title: "東京 季節限定：賞櫻", stops: ["新宿御苑", "千鳥淵"], eveningStops: 1 },
    ]);
  });

  it("lists the days out of the city", () => {
    const withTrip = days.map((d, i) => (i === 1 ? { ...d, theme: "東京 一日遊：高尾山", stops: [{ name: "高尾山", lat: 35.62, lng: 139.24 }] } : d));
    expect(measureItinerary(withTrip, ctx).suburbDays).toEqual([
      { day: 2, title: "東京 一日遊：高尾山", stops: 1, first: { name: "高尾山", lat: 35.62, lng: 139.24 } },
    ]);
  });

  it("counts legs shown as a taxi ride", () => {
    const withTaxi = days.map((d, i) =>
      i === 0 ? { ...d, stops: [d.stops[0], { ...d.stops[1], transport_from_prev: "搭計程車約 9 分鐘" }] } : d
    );
    expect(measureItinerary(withTaxi, ctx).taxiLegs).toBe(1);
  });

  it("measures the share of outdoor stops", () => {
    // Day 1 has a museum and a park.
    expect(m.outdoorShare).toBe(0.5);
  });

  it("lists each day's snack with its primary type", () => {
    const withSnack = days.map((d, i) => (i === 0 ? { ...d, meals: { ...d.meals, snack: meal("veg") } } : d));
    expect(measureItinerary(withSnack, ctx).snacks[0]).toEqual({ name: "veg", primaryType: "vegetarian_restaurant" });
  });

  it("lists each night's 小酌 except the return day's", () => {
    const withBar = days.map((d, i) => (i === 0 ? { ...d, meals: { ...d.meals, nightcap: meal("veg") } } : d));
    expect(measureItinerary(withBar, ctx).nightcaps).toEqual([
      { name: "veg", primaryType: "vegetarian_restaurant" },
      null,
      null,
    ]);
  });

  it("lists the sightseeing days' titles", () => {
    const titled = days.map((d, i) => ({ ...d, theme: i === 0 ? "東京 文化巡禮" : undefined }));
    expect(measureItinerary(titled, ctx).dayTitles).toEqual(["東京 文化巡禮", ""]);
  });

  it("leaves budget fit empty when no budget was chosen", () => {
    expect(measureItinerary(days, { ...ctx, budget: undefined }).mainMealsWithinBudget).toBeNull();
  });
});

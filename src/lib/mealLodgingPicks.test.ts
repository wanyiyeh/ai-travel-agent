import { describe, expect, it } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";
import {
  applyCandidatePicks,
  applyMealPicks,
  formatCandidateLists,
  newPickHistory,
  unusedFirst,
  type MealLodgingPools,
} from "./mealLodgingPicks";

function place(name: string, priceLevel: number | null = 2): PlaceCandidate {
  return {
    name,
    placeId: `pid-${name}`,
    lat: 35.0,
    lng: 135.7,
    address: `${name} address`,
    rating: 4.2,
    priceLevel,
    photoName: `places/pid-${name}/photos/x`,
  };
}

const pools: MealLodgingPools = {
  breakfast: [place("Cafe A"), place("Cafe B")],
  main: [place("Ramen X"), place("Sushi Y"), place("Izakaya Z")],
  snack: [place("Gelato Q")],
  lodging: [place("Hotel H", 3)],
};

describe("formatCandidateLists", () => {
  it("numbers each pool with its own prefix", () => {
    const text = formatCandidateLists(pools);
    expect(text).toContain("H1: Hotel H");
    expect(text).toContain("B2: Cafe B");
    expect(text).toContain("M3: Izakaya Z");
    expect(text).toContain("S1: Gelato Q");
  });

  it("tells the model to recommend on its own when a pool is empty", () => {
    expect(formatCandidateLists({ ...pools, snack: [] })).toMatch(/點心候選：\n（無候選/);
  });
});

describe("applyCandidatePicks", () => {
  it("fills picked candidates with their real place data", () => {
    const result = applyCandidatePicks(
      {
        accommodation: { id: "H1", name: "whatever", area: "Gion" },
        meals: [
          {
            breakfast: { id: "B1", name: "Cafe A", description: "早餐", estimated_cost: 999 },
            lunch: { id: "M1", name: "Ramen X", description: "午餐", estimated_cost: 999 },
            dinner: { id: "M2", name: "Sushi Y", description: "晚餐", estimated_cost: 999 },
            snack: { id: "S1", name: "Gelato Q", description: "點心", estimated_cost: 999 },
          },
        ],
      },
      pools,
      1,
      "JPY",
    );

    expect(result.accommodation).toMatchObject({ name: "Hotel H", area: "Gion", placeId: "pid-Hotel H", priceLevel: 3 });
    expect(result.accommodation).not.toHaveProperty("id");
    const day = result.mealsByDay[0] as Record<string, Record<string, unknown>>;
    expect(day.lunch).toMatchObject({ name: "Ramen X", placeId: "pid-Ramen X", description: "午餐", lat: 35.0 });
    expect(day.snack.photoName).toBe("places/pid-Gelato Q/photos/x");
    // priceLevel-based estimate replaces the LLM's guess when available
    expect(day.lunch.estimated_cost).not.toBe(999);
  });

  it("keeps the LLM's estimate when the candidate has no priceLevel", () => {
    const result = applyCandidatePicks(
      { meals: [{ breakfast: { id: "B1", name: "Cafe A", estimated_cost: 500 } }] },
      { ...pools, breakfast: [place("Cafe A", null)] },
      1,
      "JPY",
    );
    expect((result.mealsByDay[0].breakfast as Record<string, unknown>).estimated_cost).toBe(500);
  });

  it("fills a missing, unknown, wrong-pool, or reused pick with a real unused candidate", () => {
    const result = applyCandidatePicks(
      {
        meals: [
          {
            breakfast: { id: null, name: "Invented Cafe" },
            lunch: { id: "M9", name: "Out Of Range" },
            dinner: { id: "B1", name: "Wrong Pool" },
            snack: { id: "S1", name: "Gelato Q" },
          },
        ],
      },
      pools,
      1,
      "JPY",
    );

    const [day1] = result.mealsByDay as Array<Record<string, Record<string, unknown>>>;
    // no invented names: each slot gets the first candidate not used yet
    expect(day1.breakfast.placeId).toBe("pid-Cafe A");
    expect(day1.lunch.placeId).toBe("pid-Ramen X");
    expect(day1.dinner.placeId).toBe("pid-Sushi Y");
    expect(day1.snack.placeId).toBe("pid-Gelato Q");
  });

  it("fills whole days a truncated reply never reached", () => {
    const result = applyCandidatePicks({ meals: [] }, pools, 2, "JPY");
    const [day1, day2] = result.mealsByDay as Array<Record<string, Record<string, unknown>>>;
    expect(day1.lunch.placeId).toBe("pid-Ramen X");
    expect(day2.lunch.placeId).toBe("pid-Izakaya Z");
    expect(result.accommodation).toEqual({});
  });

  it("repeats a place only after the pool is used up, never the same or next day", () => {
    // 3 lunch/dinner places for 3 days = 6 meals
    const result = applyCandidatePicks({ meals: [] }, pools, 3, "JPY");
    const main = (result.mealsByDay as Array<Record<string, Record<string, unknown>>>).map((d) => [
      d.lunch?.name,
      d.dinner?.name,
    ]);
    expect(main[0]).toEqual(["Ramen X", "Sushi Y"]);
    expect(main[1][0]).toBe("Izakaya Z");
    // day 2 dinner: everything was used on day 1 or day 2 — nothing qualifies
    expect(main[1][1]).toBeUndefined();
    // day 3: day 1's places are two days back, so they may return
    expect([...main[2]].sort()).toEqual(["Ramen X", "Sushi Y"]);
  });

  it("keeps the LLM's own entry only when there is no candidate at all", () => {
    const empty: MealLodgingPools = { breakfast: [], main: [], snack: [], lodging: [] };
    const result = applyCandidatePicks({ meals: [{ lunch: { id: null, name: "Some Place" } }] }, empty, 1, "JPY");
    expect(result.mealsByDay[0]).toEqual({ lunch: { name: "Some Place" } });
  });
});

describe("chunked picking", () => {
  it("carries what's been used into the next chunk, reusing the original description", () => {
    const history = newPickHistory();
    // day 1: the LLM picked lunch; dinner is filled with the next unused place
    const first = applyMealPicks([{ lunch: { id: "M1", description: "Rich tonkotsu" } }], pools, 1, "JPY", history, 0);
    expect(first[0].lunch).toMatchObject({ name: "Ramen X", description: "Rich tonkotsu" });
    expect(first[0].dinner).toMatchObject({ name: "Sushi Y" });

    // next chunk's prompt lists unused places first
    expect(unusedFirst(pools, history).main.map((c) => c.name)).toEqual(["Izakaya Z", "Ramen X", "Sushi Y"]);

    // day 3 of the stay (two days after day 1): the last fresh place, then a repeat
    const later = applyMealPicks([], pools, 1, "JPY", history, 2);
    const names = [later[0].lunch, later[0].dinner].map((m) => (m as Record<string, unknown> | undefined)?.name);
    expect(names).toEqual(["Izakaya Z", "Ramen X"]);
    const repeat = later.flatMap((d) => [d.lunch, d.dinner]).find((m) => (m as Record<string, unknown>)?.name === "Ramen X");
    expect(repeat).toMatchObject({ description: "Rich tonkotsu" });
  });
});

describe("repeats once the pool is used up", () => {
  it("don't copy a whole earlier day: one day's meals come from different days", () => {
    const many: MealLodgingPools = {
      breakfast: [place("B1"), place("B2"), place("B3")],
      main: Array.from({ length: 6 }, (_, i) => place(`M${i}`)),
      snack: [place("S1"), place("S2"), place("S3")],
      lodging: [],
    };
    const meals = applyCandidatePicks({ meals: [] }, many, 9, "JPY").mealsByDay as Array<
      Record<string, Record<string, unknown>>
    >;
    const firstUse = new Map<unknown, number>();
    meals.forEach((d, day) =>
      Object.values(d).forEach((m) => {
        if (!firstUse.has(m.name)) firstUse.set(m.name, day);
      })
    );
    // for every later day, its four meals must not all have first appeared on one same day
    for (let day = 3; day < meals.length; day++) {
      const origins = new Set(Object.values(meals[day]).map((m) => firstUse.get(m.name)));
      expect(origins.size).toBeGreaterThan(1);
    }
  });
});

describe("the LLM's own repeat choice", () => {
  it("is overridden by the least-visited place, so one favourite doesn't keep coming back", () => {
    const history = newPickHistory();
    // days 1-2 use all three places; Ramen X a second time on day 3
    applyMealPicks([], pools, 2, "JPY", history, 0);
    const [ramen, sushi] = pools.main;
    history.visits.set(ramen, 2);
    history.lastDay.set(ramen, 0);
    history.lastDay.set(sushi, 0);

    // day 4: the LLM asks for Ramen X again (M1), but the others have fewer visits
    const [day4] = applyMealPicks([{ lunch: { id: "M1" } }], pools, 1, "JPY", history, 3);
    expect(["Sushi Y", "Izakaya Z"]).toContain((day4.lunch as Record<string, unknown>).name);
  });
});

// Story: a traveler who picked both 咖啡 and 抹茶／茶 should get them on
// alternate afternoons; the AI doesn't keep to an alternation it's told about.
describe("applyMealPicks with a snack rotation", () => {
  const coffee = [place("Coffee 1"), place("Coffee 2")];
  const tea = [place("Tea 1"), place("Tea 2")];
  const rotating: MealLodgingPools = { ...pools, snack: [coffee[0], tea[0], coffee[1], tea[1]], snackRotation: [coffee, tea] };
  const snackNames = (days: Array<Record<string, unknown>>) => days.map((d) => (d.snack as { name: string }).name);

  it("alternates the drinks by day, even when the AI picks coffee every day", () => {
    const raw = [{ snack: { id: "S1" } }, { snack: { id: "S3" } }, { snack: { id: "S3" } }];
    const days = applyMealPicks(raw, rotating, 3, "JPY", newPickHistory());
    expect(snackNames(days)).toEqual(["Coffee 1", "Tea 1", "Coffee 2"]);
  });

  it("falls back to the whole snack list once the day's drink has nothing left", () => {
    const short: MealLodgingPools = { ...pools, snack: [coffee[0], place("Gelato Q")], snackRotation: [[coffee[0]]] };
    const days = applyMealPicks([], short, 2, "JPY", newPickHistory());
    expect(snackNames(days)).toEqual(["Coffee 1", "Gelato Q"]);
  });

  it("keeps the rotation in a later chunk's reordered pools", () => {
    expect(unusedFirst(rotating, newPickHistory()).snackRotation).toBe(rotating.snackRotation);
  });
});

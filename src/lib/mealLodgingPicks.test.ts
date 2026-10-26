import { describe, expect, it } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { newPickHistory, pickAccommodation, pickMeals, type MealLodgingPools } from "./mealLodgingPicks";

function place(name: string, priceLevel: number | null = 2, types?: string[]): PlaceCandidate {
  return {
    name,
    placeId: `pid-${name}`,
    lat: 35.0,
    lng: 135.7,
    address: `${name} address`,
    rating: 4.2,
    priceLevel,
    photoName: `places/pid-${name}/photos/x`,
    ...(types ? { types } : {}),
  };
}

const pools: MealLodgingPools = {
  breakfast: [place("Cafe A"), place("Cafe B")],
  main: [place("Ramen X"), place("Sushi Y"), place("Izakaya Z")],
  snack: [place("Gelato Q")],
  lodging: [place("Hotel H", 3), place("Hotel I", 3)],
  nightcap: [],
};

type Day = Record<string, Record<string, unknown>>;

describe("pickAccommodation", () => {
  it("takes the first lodging candidate, with the city as its area", () => {
    const stay = pickAccommodation(pools, "JPY", "京都");
    expect(stay).toMatchObject({ name: "Hotel H", area: "京都", placeId: "pid-Hotel H", priceLevel: 3 });
    // Google's address is not stored as the area (ADR-0004)
    expect(stay.area).not.toBe("Hotel H address");
  });

  it("returns nothing without a lodging candidate", () => {
    expect(pickAccommodation({ ...pools, lodging: [] }, "JPY", "京都")).toEqual({});
  });
});

describe("pickMeals", () => {
  it("fills every slot with real place data, in pool order, with no description", () => {
    const [day] = pickMeals(pools, 1, "JPY") as Day[];
    expect(day.breakfast).toMatchObject({ name: "Cafe A", placeId: "pid-Cafe A", lat: 35.0 });
    expect(day.lunch).toMatchObject({ name: "Ramen X" });
    expect(day.dinner).toMatchObject({ name: "Sushi Y" });
    expect(day.snack.photoName).toBe("places/pid-Gelato Q/photos/x");
    expect(day.lunch).not.toHaveProperty("description");
    expect(day).not.toHaveProperty("nightcap");
  });

  it("repeats a place only after the pool is used up, never the same or next day", () => {
    // 3 lunch/dinner places for 3 days = 6 meals
    const main = (pickMeals(pools, 3, "JPY") as Day[]).map((d) => [d.lunch?.name, d.dinner?.name]);
    expect(main[0]).toEqual(["Ramen X", "Sushi Y"]);
    expect(main[1][0]).toBe("Izakaya Z");
    // day 2 dinner: everything was used on day 1 or day 2 — nothing qualifies
    expect(main[1][1]).toBeUndefined();
    // day 3: day 1's places are two days back, so they may return
    expect([...main[2]].sort()).toEqual(["Ramen X", "Sushi Y"]);
  });

  it("carries what's been used across calls through the history", () => {
    const history = newPickHistory();
    pickMeals(pools, 1, "JPY", history, 0);
    const [later] = pickMeals(pools, 1, "JPY", history, 2) as Day[];
    expect([later.lunch?.name, later.dinner?.name]).toEqual(["Izakaya Z", "Ramen X"]);
  });

  it("doesn't copy a whole earlier day once the pool is used up", () => {
    const many: MealLodgingPools = {
      breakfast: [place("B1"), place("B2"), place("B3")],
      main: Array.from({ length: 6 }, (_, i) => place(`M${i}`)),
      snack: [place("S1"), place("S2"), place("S3")],
      lodging: [],
      nightcap: [],
    };
    const meals = pickMeals(many, 9, "JPY") as Day[];
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

  // Story: two ramen shops on one day, lunch and dinner, when the pool had sushi too.
  it("gives dinner another kind of food than lunch when there's an unused one", () => {
    const kinds: MealLodgingPools = {
      ...pools,
      main: [place("Ichiran", 2, ["ramen_restaurant"]), place("Afuri", 2, ["ramen_restaurant"]), place("Sushi Y", 2, ["sushi_restaurant"])],
    };
    const [day] = pickMeals(kinds, 1, "JPY") as Day[];
    expect([day.lunch.name, day.dinner.name]).toEqual(["Ichiran", "Sushi Y"]);
  });

  it("still repeats the kind when nothing else is unused, and ignores plain 「restaurant」", () => {
    const ramenOnly: MealLodgingPools = { ...pools, main: [place("Ichiran", 2, ["ramen_restaurant"]), place("Afuri", 2, ["ramen_restaurant"])] };
    const [day] = pickMeals(ramenOnly, 1, "JPY") as Day[];
    expect([day.lunch.name, day.dinner.name]).toEqual(["Ichiran", "Afuri"]);

    const plain: MealLodgingPools = { ...pools, main: [place("A", 2, ["restaurant"]), place("B", 2, ["restaurant"]), place("C", 2, ["sushi_restaurant"])] };
    const [plainDay] = pickMeals(plain, 1, "JPY") as Day[];
    expect([plainDay.lunch.name, plainDay.dinner.name]).toEqual(["A", "B"]);
  });
});

// Story: a traveler who picked both 咖啡 and 抹茶／茶 should get them on
// alternate afternoons.
describe("pickMeals with a snack rotation", () => {
  const coffee = [place("Coffee 1"), place("Coffee 2")];
  const tea = [place("Tea 1"), place("Tea 2")];
  const snackNames = (days: Array<Record<string, unknown>>) => days.map((d) => (d.snack as { name: string }).name);

  it("alternates the drinks by day", () => {
    const rotating: MealLodgingPools = { ...pools, snack: [coffee[0], tea[0], coffee[1], tea[1]], snackRotation: [coffee, tea] };
    expect(snackNames(pickMeals(rotating, 3, "JPY"))).toEqual(["Coffee 1", "Tea 1", "Coffee 2"]);
  });

  it("falls back to the whole snack list once the day's drink has nothing left", () => {
    const short: MealLodgingPools = { ...pools, snack: [coffee[0], place("Gelato Q")], snackRotation: [[coffee[0]]] };
    expect(snackNames(pickMeals(short, 2, "JPY"))).toEqual(["Coffee 1", "Gelato Q"]);
  });
});

describe("pickMeals — Google's open-ended prices", () => {
  it("marks a cost from 「NT$2,000+」 as a floor, and a closed range not", () => {
    const fine = { ...place("THOMAS CHIEN", 4), priceRange: { currency: "TWD", start: 2000 } };
    const bistro = { ...place("拾光餐酒館", 2), priceRange: { currency: "TWD", start: 600, end: 1200 } };
    const [day] = pickMeals({ ...pools, main: [fine, bistro] }, 1, "TWD");
    expect(day.lunch).toMatchObject({ name: "THOMAS CHIEN", estimated_cost: 2000, estimated_cost_from: true });
    expect(day.dinner).toMatchObject({ name: "拾光餐酒館", estimated_cost: 900 });
    expect(day.dinner).not.toHaveProperty("estimated_cost_from");
  });
});

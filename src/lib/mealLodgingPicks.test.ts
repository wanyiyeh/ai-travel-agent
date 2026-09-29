import { describe, expect, it } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { applyCandidatePicks, formatCandidateLists, type MealLodgingPools } from "./mealLodgingPicks";

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

  it("falls back to the LLM's own entry for a missing, unknown, wrong-pool, or reused id", () => {
    const result = applyCandidatePicks(
      {
        meals: [
          {
            breakfast: { id: null, name: "Invented Cafe" },
            lunch: { id: "M9", name: "Out Of Range" },
            dinner: { id: "B1", name: "Wrong Pool" },
            snack: { id: "S1", name: "Gelato Q" },
          },
          { snack: { id: "S1", name: "Gelato Q again" } },
        ],
      },
      pools,
      2,
      "JPY",
    );

    const [day1, day2] = result.mealsByDay as Array<Record<string, Record<string, unknown>>>;
    expect(day1.breakfast).toEqual({ name: "Invented Cafe" });
    expect(day1.lunch).toEqual({ name: "Out Of Range" });
    expect(day1.dinner).toEqual({ name: "Wrong Pool" });
    expect(day1.snack.placeId).toBe("pid-Gelato Q");
    // Same candidate twice: the second slot doesn't get the duplicate place.
    expect(day2.snack).toEqual({ name: "Gelato Q again" });
  });

  it("always returns stayDays entries even if the model returned fewer", () => {
    const result = applyCandidatePicks({ meals: [] }, pools, 3, "JPY");
    expect(result.mealsByDay).toEqual([{}, {}, {}]);
    expect(result.accommodation).toEqual({});
  });
});

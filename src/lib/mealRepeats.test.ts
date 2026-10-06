import { describe, expect, it } from "vitest";
import { findRepeatedMeals, plannedLabel, plannedSlotsByPlace, slotKey } from "./mealRepeats";

const day = (n: number, meals: Record<string, string>) => ({
  day: n,
  meals: Object.fromEntries(Object.entries(meals).map(([k, placeId]) => [k, { name: placeId, placeId }])),
});

const trip = [
  day(1, { breakfast: "cafe", lunch: "ramen", dinner: "sushi" }),
  day(2, { lunch: "udon" }),
  day(3, { lunch: "ramen", dinner: "ramen-again" }),
  day(5, { dinner: "ramen" }),
];

describe("findRepeatedMeals", () => {
  it("marks the second and later visits with the day before", () => {
    const repeats = findRepeatedMeals(trip);
    expect(repeats.get(slotKey(3, "lunch"))).toEqual({ visit: 2, previousDay: 1 });
    expect(repeats.get(slotKey(5, "dinner"))).toEqual({ visit: 3, previousDay: 3 });
  });

  it("leaves first visits and places without a placeId unmarked", () => {
    const repeats = findRepeatedMeals([...trip, { day: 6, meals: { lunch: { name: "Invented" } } }]);
    expect(repeats.has(slotKey(1, "lunch"))).toBe(false);
    expect(repeats.has(slotKey(6, "lunch"))).toBe(false);
    expect(repeats.size).toBe(2);
  });
});

describe("plannedSlotsByPlace", () => {
  it("lists where each place is planned, except the slot being swapped", () => {
    const planned = plannedSlotsByPlace(trip, { day: 3, mealType: "lunch" });
    expect(planned.get("ramen")).toEqual([
      { day: 1, mealType: "lunch" },
      { day: 5, mealType: "dinner" },
    ]);
    expect(planned.has("udon")).toBe(true);
  });
});

describe("plannedLabel", () => {
  it("names the first slot and counts the rest", () => {
    expect(plannedLabel([{ day: 3, mealType: "dinner" }])).toBe("第 3 天晚餐已安排");
    expect(plannedLabel([{ day: 1, mealType: "lunch" }, { day: 5, mealType: "dinner" }])).toBe("第 1 天午餐等 2 餐已安排");
  });
});

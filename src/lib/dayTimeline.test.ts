import { describe, expect, it } from "vitest";
import { buildDayTimeline, type TimeOfDay } from "./dayTimeline";

type S = { name: string; tod?: TimeOfDay };

const labels = (items: ReturnType<typeof buildDayTimeline<S, string | null>>) =>
  items.map((i) => (i.kind === "stop" ? i.stop.name : i.mealType));

const build = (stops: S[], meals: Parameters<typeof buildDayTimeline<S, string | null>>[1]) =>
  buildDayTimeline<S, string | null>(stops, meals, (s) => s.tod);

const allMeals = { breakfast: "B", lunch: "L", snack: "S", dinner: "D" };

describe("buildDayTimeline", () => {
  it("puts lunch before the first afternoon stop", () => {
    const stops: S[] = [
      { name: "a", tod: "morning" },
      { name: "b", tod: "morning" },
      { name: "c", tod: "afternoon" },
    ];
    expect(labels(build(stops, allMeals))).toEqual(["breakfast", "a", "b", "lunch", "c", "snack", "dinner"]);
  });

  it("falls back to mid-day when no stop is tagged afternoon", () => {
    const stops: S[] = [{ name: "a" }, { name: "b" }, { name: "c" }];
    expect(labels(build(stops, { lunch: "L" }))).toEqual(["a", "b", "lunch", "c"]);
  });

  it("keeps each stop's original index", () => {
    const items = build([{ name: "a", tod: "morning" }, { name: "b", tod: "afternoon" }], allMeals);
    const stopIndexes = items.flatMap((i) => (i.kind === "stop" ? [i.stopIndex] : []));
    expect(stopIndexes).toEqual([0, 1]);
  });

  it("includes null slots for meals not picked yet, and skips absent keys", () => {
    const items = build([{ name: "a" }], { breakfast: null, dinner: "D" });
    expect(items.filter((i) => i.kind === "meal")).toEqual([
      { kind: "meal", mealType: "breakfast", meal: null },
      { kind: "meal", mealType: "dinner", meal: "D" },
    ]);
  });

  it("handles a day with meals but no stops", () => {
    expect(labels(build([], allMeals))).toEqual(["breakfast", "lunch", "snack", "dinner"]);
  });
});

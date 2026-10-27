import { describe, expect, it } from "vitest";
import { buildDayTimeline, mealPositionsOf, mealsInOrder, timeOfDayBetweenMeals, type MealPositions, type TimeOfDay } from "./dayTimeline";

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

describe("buildDayTimeline — 小酌", () => {
  it("puts the 小酌 after dinner", () => {
    expect(labels(build([{ name: "Temple", tod: "morning" }], { ...allMeals, nightcap: "N" }))).toEqual([
      "breakfast",
      "Temple",
      "lunch",
      "snack",
      "dinner",
      "nightcap",
    ]);
  });
});

// Story: on a concert night dinner was shown after the show — a 21:00 finish.
describe("buildDayTimeline — dinner before an evening show", () => {
  type T = S & { show?: boolean };
  it("puts the snack and dinner right before the show, the 小酌 after it", () => {
    const stops: T[] = [{ name: "Museum", tod: "morning" }, { name: "Park", tod: "afternoon" }, { name: "Concert", tod: "evening", show: true }];
    const items = buildDayTimeline<T, string | null>(stops, { ...allMeals, nightcap: "N" }, (s) => s.tod, (s) => Boolean(s.show));
    expect(items.map((i) => (i.kind === "stop" ? i.stop.name : i.mealType))).toEqual([
      "breakfast",
      "Museum",
      "lunch",
      "Park",
      "snack",
      "dinner",
      "Concert",
      "nightcap",
    ]);
  });

  it("leaves a day without a show as it was", () => {
    const stops: T[] = [{ name: "Museum", tod: "morning" }];
    const items = buildDayTimeline<T, string | null>(stops, allMeals, (s) => s.tod, (s) => Boolean(s.show));
    expect(items[items.length - 1]).toMatchObject({ kind: "meal", mealType: "dinner" });
  });
});

// Story (#287): with four stops, lunch always fell between the 2nd and 3rd,
// and no stop could come after dinner — a sunset viewpoint after eating.
describe("buildDayTimeline — meals the traveler placed (ADR-0010)", () => {
  const four: S[] = [
    { name: "a", tod: "morning" },
    { name: "b", tod: "morning" },
    { name: "c", tod: "afternoon" },
    { name: "d", tod: "evening" },
  ];
  const placed = (positions: MealPositions) =>
    labels(buildDayTimeline<S, string | null>(four, allMeals, (s) => s.tod, undefined, { positions }));

  it("puts each placed meal after that many stops", () => {
    expect(placed({ lunch: 1, snack: 2, dinner: 3 })).toEqual(["breakfast", "a", "lunch", "b", "snack", "c", "dinner", "d"]);
  });

  it("falls back to the rule for a meal not placed, without passing a placed one", () => {
    expect(placed({ dinner: 3 })).toEqual(["breakfast", "a", "b", "lunch", "c", "snack", "dinner", "d"]);
  });

  it("keeps meals that share a spot in lunch, snack, dinner order", () => {
    expect(placed({ lunch: 2, snack: 2, dinner: 2 })).toEqual(["breakfast", "a", "b", "lunch", "snack", "dinner", "c", "d"]);
  });

  it("puts a meal past the last stop at the end, after a stop was deleted", () => {
    expect(placed({ lunch: 2, snack: 9, dinner: 9 })).toEqual(["breakfast", "a", "b", "lunch", "c", "d", "snack", "dinner"]);
  });

  it("counts positions over the whole day when given only some stops", () => {
    // the map leaves out stop b (no coordinates): lunch after 2 stops still sits before c
    const shown = [four[0], four[2], four[3]];
    const dayIndex = new Map(four.map((s, i) => [s, i]));
    const items = buildDayTimeline<S, string | null>(shown, { lunch: "L" }, (s) => s.tod, undefined, {
      positions: { lunch: 2 },
      indexOf: (s) => dayIndex.get(s)!,
    });
    expect(labels(items)).toEqual(["a", "lunch", "c", "d"]);
  });

  it("round-trips through mealPositionsOf", () => {
    const positions = { lunch: 1, snack: 3, dinner: 3 };
    const items = buildDayTimeline<S, string | null>(four, allMeals, (s) => s.tod, undefined, { positions });
    expect(mealPositionsOf(items)).toEqual(positions);
  });
});

describe("mealsInOrder", () => {
  const meal = (mealType: "lunch" | "snack" | "dinner" | "breakfast") => ({ kind: "meal" as const, mealType, meal: null });
  const stop = { kind: "stop" as const, stop: { name: "a" }, stopIndex: 0 };

  it("accepts lunch, snack, dinner with stops anywhere between them", () => {
    expect(mealsInOrder([meal("breakfast"), meal("lunch"), stop, meal("snack"), meal("dinner")])).toBe(true);
  });

  it("rejects dinner before lunch", () => {
    expect(mealsInOrder([meal("dinner"), stop, meal("lunch")])).toBe(false);
  });
});

describe("timeOfDayBetweenMeals", () => {
  it("is morning before lunch, evening from dinner on, afternoon between", () => {
    const positions = { lunch: 1, dinner: 3 };
    expect([0, 1, 2, 3].map((i) => timeOfDayBetweenMeals(i, positions))).toEqual(["morning", "afternoon", "afternoon", "evening"]);
  });

  it("leaves the time to the caller's rule when no meal was placed", () => {
    expect(timeOfDayBetweenMeals(0, {})).toBeUndefined();
    expect(timeOfDayBetweenMeals(0, { snack: 1 })).toBeUndefined();
  });
});

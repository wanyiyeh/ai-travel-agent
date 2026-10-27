import { describe, expect, it } from "vitest";
import { dropInDay, mealDragId, parseMealDragId } from "./mealDrag";

const L = mealDragId("d1", "lunch");
const S = mealDragId("d1", "snack");
const D = mealDragId("d1", "dinner");

describe("meal drag ids", () => {
  it("round-trips, even with a colon in the day id", () => {
    expect(parseMealDragId(mealDragId("a:b", "dinner"))).toEqual({ dayId: "a:b", mealType: "dinner" });
  });

  it("isn't a stop id or an unmovable meal", () => {
    expect(parseMealDragId("stop-1")).toBeNull();
    expect(parseMealDragId("meal:d1:breakfast")).toBeNull();
  });
});

describe("dropInDay", () => {
  // a, b, lunch, c, d, snack, dinner — the friend's Hermanus day
  const day = ["a", "b", L, "c", "d", S, D];

  it("moves lunch up: one stop before it", () => {
    expect(dropInDay(day, L, "b")).toEqual({ ok: true, stopIds: ["a", "b", "c", "d"], mealPositions: { lunch: 1, snack: 4, dinner: 4 } });
  });

  it("is what the screen showed when a stop crosses a meal", () => {
    // c dropped on b: b and lunch slide down, so three stops come before lunch
    expect(dropInDay(day, "c", "b")).toEqual({ ok: true, stopIds: ["a", "c", "b", "d"], mealPositions: { lunch: 3, snack: 4, dinner: 4 } });
    // c dropped on lunch: lunch slides down past it
    expect(dropInDay(day, "c", L)).toEqual({ ok: true, stopIds: ["a", "b", "c", "d"], mealPositions: { lunch: 3, snack: 4, dinner: 4 } });
  });

  it("refuses dinner before the snack, naming the snack as in the way", () => {
    expect(dropInDay(day, D, "d")).toEqual({ ok: false, moved: "dinner", blocking: "snack" });
  });

  it("lets dinner go before the last stop once the snack is out of the way", () => {
    const noSnack = ["a", "b", L, "c", "d", D];
    expect(dropInDay(noSnack, D, "d")).toEqual({ ok: true, stopIds: ["a", "b", "c", "d"], mealPositions: { lunch: 2, dinner: 3 } });
  });

  it("refuses a stop drag that would put the snack after dinner", () => {
    expect(dropInDay(["a", S, "b", D], S, D)).toEqual({ ok: false, moved: "snack", blocking: "dinner" });
  });

  it("does nothing for an id that isn't on this day", () => {
    expect(dropInDay(day, "x", "a")).toBeNull();
  });
});

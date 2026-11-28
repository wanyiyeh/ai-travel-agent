import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {}, j: (v: unknown) => JSON.stringify(v) }));

const { proposalProblem } = await import("@/lib/chat/proposalRules");
const { applyDirect } = await import("@/lib/chat/proposals");

const days = () => [
  {
    id: "d1",
    day: 1,
    stops: [
      { id: "a", duration_minutes: 60 },
      { id: "b", duration_minutes: 60 },
      { id: "c", duration_minutes: 60, fixedEvent: { time: "19:00" } },
    ],
    meals: { lunch: { placeId: "m1" }, dinner: { placeId: "m2", fixedEvent: { time: "19:00" } } },
    skippedMeals: ["snack"],
    accommodation: { placeId: "h1" },
  },
  {
    id: "d2",
    day: 2,
    isTransitDay: true,
    stops: [
      { id: "x", duration_minutes: 60 },
      { id: "t", kind: "transit", name: "搭乘新幹線前往京都" },
      { id: "y", duration_minutes: 60 },
      { id: "z", duration_minutes: 60 },
    ],
  },
  { id: "d3", day: 3, isLocked: true, stops: [{ id: "l", duration_minutes: 480 }] },
];

describe("proposalProblem", () => {
  it("allows what the buttons allow", () => {
    expect(proposalProblem(days(), { action: "remove_stop", params: { dayId: "d1", stopId: "a" } })).toBeNull();
    expect(proposalProblem(days(), { action: "move_stop", params: { dayId: "d2", stopId: "y", toIndex: 3 } })).toBeNull();
    expect(proposalProblem(days(), { action: "replace_meal", params: { dayId: "d1", mealType: "lunch", request: "拉麵" } })).toBeNull();
    expect(proposalProblem(days(), { action: "restore_meal", params: { dayId: "d1", mealType: "snack" } })).toBeNull();
    expect(proposalProblem(days(), { action: "replace_accommodation", params: { dayId: "d1" } })).toBeNull();
  });

  it("keeps transit rides, booked events and locked days as they are", () => {
    expect(proposalProblem(days(), { action: "remove_stop", params: { dayId: "d2", stopId: "t" } })).toContain("城市間的交通");
    expect(proposalProblem(days(), { action: "replace_stop", params: { dayId: "d1", stopId: "c" } })).toContain("固定行程");
    expect(proposalProblem(days(), { action: "remove_stop", params: { dayId: "d3", stopId: "l" } })).toContain("鎖定");
    expect(proposalProblem(days(), { action: "suggest_stops", params: { dayId: "d3", request: null } })).toContain("鎖定");
    expect(proposalProblem(days(), { action: "remove_meal", params: { dayId: "d1", mealType: "dinner" } })).toContain("訂好位");
    expect(proposalProblem(days(), { action: "replace_meal", params: { dayId: "d1", mealType: "dinner", request: null } })).toContain("訂好位");
  });

  it("keeps a stop on its side of the transit ride", () => {
    expect(proposalProblem(days(), { action: "move_stop", params: { dayId: "d2", stopId: "x", toIndex: 2 } })).toContain("另一邊");
    expect(proposalProblem(days(), { action: "move_stop", params: { dayId: "d2", stopId: "z", toIndex: 0 } })).toContain("另一邊");
  });

  it("notices a trip that changed since the proposal", () => {
    expect(proposalProblem(days(), { action: "remove_stop", params: { dayId: "d1", stopId: "gone" } })).toContain("不在行程裡");
    expect(proposalProblem(days(), { action: "remove_stop", params: { dayId: "d9", stopId: "a" } })).toContain("不在行程裡");
    expect(proposalProblem(days(), { action: "move_stop", params: { dayId: "d1", stopId: "a", toIndex: 3 } })).toContain("超出");
    expect(proposalProblem(days(), { action: "remove_meal", params: { dayId: "d1", mealType: "breakfast" } })).toContain("不在行程裡");
    expect(proposalProblem(days(), { action: "restore_meal", params: { dayId: "d1", mealType: "lunch" } })).toContain("沒有被刪除");
    expect(proposalProblem(days(), { action: "replace_accommodation", params: { dayId: "d2" } })).toContain("沒有住宿");
  });
});

describe("applyDirect", () => {
  it("removes a stop and keeps it for the trash", () => {
    const original = days();
    const applied = applyDirect(original, { action: "remove_stop", params: { dayId: "d1", stopId: "b" } })!;
    expect((applied.days[0].stops as { id: string }[]).map((s) => s.id)).toEqual(["a", "c"]);
    expect(applied.trashed).toEqual({ dayId: "d1", dayNumber: 1, originalIndex: 1, stop: { id: "b", duration_minutes: 60 } });
    expect(applied.recalculateDayId).toBe("d1");
    expect(original[0].stops).toHaveLength(3); // works on a copy
  });

  it("moves a stop within its day", () => {
    const applied = applyDirect(days(), { action: "move_stop", params: { dayId: "d1", stopId: "a", toIndex: 1 } })!;
    expect(applied.days[0].stops).toEqual([
      { id: "b", duration_minutes: 60, orderIndex: 0 },
      { id: "a", duration_minutes: 60, orderIndex: 1 },
      { id: "c", duration_minutes: 60, fixedEvent: { time: "19:00" }, orderIndex: 2 },
    ]);
  });

  it("removes and restores meals", () => {
    const removed = applyDirect(days(), { action: "remove_meal", params: { dayId: "d1", mealType: "lunch" } })!;
    expect(removed.days[0]).toMatchObject({ skippedMeals: ["snack", "lunch"] });
    expect((removed.days[0].meals as Record<string, unknown>).lunch).toBeUndefined();
    const restored = applyDirect(days(), { action: "restore_meal", params: { dayId: "d1", mealType: "snack" } })!;
    expect(restored.days[0].skippedMeals).toEqual([]);
    // The slot comes back empty: the screen opens that meal's picker next.
    expect(restored.then).toEqual({ picker: "meal", dayId: "d1", mealType: "snack", request: null });
    expect(removed.then).toBeUndefined();
  });

  it("leaves changes that need a pick to the picker", () => {
    expect(applyDirect(days(), { action: "replace_stop", params: { dayId: "d1", stopId: "a" } })).toBeNull();
    expect(applyDirect(days(), { action: "replace_meal", params: { dayId: "d1", mealType: "lunch", request: null } })).toBeNull();
  });
});

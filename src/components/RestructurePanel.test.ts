import { describe, expect, it } from "vitest";
import {
  computeCityDiff,
  computeStructuralDayIds,
  groupExistingDays,
  minCityDays,
  syncKeepDaysForTarget,
  type CityEntryState,
  type RestructureDayLite,
} from "@/components/RestructurePanel";

// 東京 4 days: day 2 has the concert, day 4 is the trip's last (structural).
const days: RestructureDayLite[] = [
  { id: "d1", day: 1, waypointCity: "東京", stopCount: 3 },
  { id: "d2", day: 2, waypointCity: "東京", stopCount: 2, bookedEventLabel: "演唱會 11/12" },
  { id: "d3", day: 3, waypointCity: "東京", stopCount: 3 },
  { id: "d4", day: 4, waypointCity: "東京", stopCount: 1 },
];
const tokyo = (): CityEntryState => groupExistingDays(days, computeStructuralDayIds(days))[0];
const kept = (c: CityEntryState) => [...c.keepDayIds].sort();

describe("restructure wizard — a booked event's day", () => {
  it("is kept first when the city shrinks", () => {
    // 2 days: the last (structural) and one sightseeing day — the concert's, not day 1.
    expect(kept(syncKeepDaysForTarget({ ...tokyo(), targetDays: 2 }))).toEqual(["d2", "d4"]);
  });

  it("stays kept even after the traveler picked days by hand", () => {
    const picked = { ...tokyo(), keepDayIds: new Set(["d1", "d2", "d3", "d4"]), touchedKeep: true, targetDays: 2 };
    expect(kept(syncKeepDaysForTarget(picked))).toEqual(["d2", "d4"]);
  });

  it("counts towards the fewest days the city can have", () => {
    expect(minCityDays(tokyo())).toBe(2); // the last day + the concert's
  });

  it("shows up in the diff as kept, the others as removed", () => {
    const diff = computeCityDiff(syncKeepDaysForTarget({ ...tokyo(), targetDays: 2 }));
    expect(diff.removed).toEqual(["d1", "d3"]);
    expect(diff.addedAiDays).toBe(0);
  });
});

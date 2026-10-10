import { describe, expect, it } from "vitest";
import {
  bookedDateShift,
  computeCityDiff,
  newDaysHint,
  relinkCities,
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

describe("restructure wizard — hints", () => {
  const layout = (c: CityEntryState) => ({ isNew: c.isNew, targetDays: c.targetDays, keepDayIds: [...c.keepDayIds] });
  const isStructural = (id: string) => id === "d4";
  const concertDay = { ...days[1], bookedEventDate: "2026-11-12" };

  it("says nothing when the concert stays on its date", () => {
    // Departing 11/11: day 2 is 11/12.
    expect(bookedDateShift(concertDay, [layout(tokyo())], 0, isStructural, "d4", "2026-11-11")).toBeUndefined();
  });

  it("warns when a new city before it moves the concert to another date", () => {
    const kyoto = { isNew: true, targetDays: 2, keepDayIds: [] };
    expect(bookedDateShift(concertDay, [kyoto, layout({ ...tokyo(), targetDays: 5 })], 1, isStructural, "d4", "2026-11-11")).toEqual({
      dayNumber: 5, // 京都 days 1-2, the transit day 3, d1 day 4, d2 day 5
      date: "2026-11-15",
    });
  });

  it("says what the new days will likely hold", () => {
    expect(newDaysHint(1)).toBe("依你的偏好排主題");
    expect(newDaysHint(2)).toBe("依你的偏好排主題，通常有一天半日遊");
    expect(newDaysHint(3)).toBe("依你的偏好排主題，通常有一天郊區一日遊");
  });
});

describe("restructure wizard — inserting a city before an existing one", () => {
  // 東京 d1 + its day to 京都 (d2); 京都 d3, d4 and the trip's last day d5.
  const trip: RestructureDayLite[] = [
    { id: "d1", day: 1, waypointCity: "東京", stopCount: 3 },
    { id: "d2", day: 2, waypointCity: "東京", stopCount: 1, isTransitDay: true },
    { id: "d3", day: 3, waypointCity: "京都", stopCount: 3 },
    { id: "d4", day: 4, waypointCity: "京都", stopCount: 3 },
    { id: "d5", day: 5, waypointCity: "京都", stopCount: 1 },
  ];
  const [tokyoCity, kyotoCity] = groupExistingDays(trip, computeStructuralDayIds(trip));
  const nagoya: CityEntryState = {
    ...tokyoCity,
    key: "nagoya",
    name: "名古屋",
    isNew: true,
    existingDayIds: [],
    structuralDayIds: new Set(),
    bookedDayIds: new Set(),
    keepDayIds: new Set(),
    targetDays: 2,
    hasOutboundTransit: false,
  };

  it("moves the transit day from 東京 to 京都, so every existing day stays", () => {
    const [tokyoAfter, , kyotoAfter] = relinkCities([tokyoCity, nagoya, kyotoCity]);
    expect(tokyoAfter.targetDays).toBe(1); // its day to 京都 becomes 名古屋's
    expect(kyotoAfter.targetDays).toBe(4); // gains the day from 名古屋
    expect(computeCityDiff(tokyoAfter)).toMatchObject({ removed: [], keptCount: 1, addedAiDays: 0 });
    expect(computeCityDiff(kyotoAfter)).toMatchObject({ removed: [], keptCount: 3, addedAiDays: 0 });
  });

  it("puts the days back when the new city is removed again", () => {
    const inserted = relinkCities([tokyoCity, nagoya, kyotoCity]);
    const removed = relinkCities(inserted.filter((c) => c.key !== "nagoya"));
    expect(removed.map((c) => c.targetDays)).toEqual([2, 3]);
  });
});

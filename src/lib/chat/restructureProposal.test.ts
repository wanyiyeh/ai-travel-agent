import { describe, expect, it } from "vitest";
import { planRestructure } from "@/lib/chat/restructureProposal";

// 東京 days 1–3 (day 3 is the ride to 京都), 京都 days 4–5 (day 5 flies home).
const days = [
  { id: "d1", day: 1, waypointCity: "東京", stops: [] },
  { id: "d2", day: 2, waypointCity: "東京", stops: [] },
  { id: "d3", day: 3, waypointCity: "東京", isTransitDay: true, transitTo: "京都", stops: [] },
  { id: "d4", day: 4, waypointCity: "京都", stops: [] },
  { id: "d5", day: 5, waypointCity: "京都", stops: [] },
];
const config = {};
const city = (name: string, n: number, isNew = false) => ({ name, days: n, isNew });

function ok(plan: ReturnType<typeof planRestructure>) {
  if (!plan.ok) throw new Error(plan.problem);
  return plan;
}

describe("planRestructure", () => {
  it("adds a day to a city and keeps all its days", () => {
    const plan = ok(planRestructure(days, config, [city("東京", 3), city("京都", 3)]));
    expect(plan.request.cities).toEqual([
      { name: "東京", isNew: false, targetDays: 3, keepDayIds: ["d1", "d2", "d3"], lockedAttractions: [] },
      { name: "京都", isNew: false, targetDays: 3, keepDayIds: ["d4", "d5"], lockedAttractions: [] },
    ]);
    expect(plan.preview[1]).toEqual({ name: "京都", isNew: false, daysBefore: 2, daysAfter: 3, removedDayNumbers: [], newDays: 1 });
  });

  it("takes a day off a city, keeping its leaving day and dropping its last sightseeing day", () => {
    const plan = ok(planRestructure(days, config, [city("東京", 2), city("京都", 2)]));
    expect(plan.request.cities[0]).toMatchObject({ targetDays: 2, keepDayIds: ["d1", "d3"] });
    expect(plan.preview[0]).toMatchObject({ daysBefore: 3, daysAfter: 2, removedDayNumbers: [2], newDays: 0 });
  });

  it("inserts a new city without shifting days between its neighbours", () => {
    // 東京 and 京都 keep the counts the trip shows; 名古屋's 2 days include its arrival.
    const plan = ok(planRestructure(days, config, [city("東京", 3), city("名古屋", 2, true), city("京都", 2)]));
    expect(plan.request.cities).toEqual([
      // 東京's ride to 京都 gives way to 名古屋's own arrival day.
      { name: "東京", isNew: false, targetDays: 2, keepDayIds: ["d1", "d2", "d3"], lockedAttractions: [] },
      { name: "名古屋", isNew: true, targetDays: 2, keepDayIds: [], lockedAttractions: [] },
      // 京都 gains its arrival day from 名古屋 and still keeps day 4.
      { name: "京都", isNew: false, targetDays: 3, keepDayIds: ["d4", "d5"], lockedAttractions: [] },
    ]);
    expect(plan.preview.map((c) => c.removedDayNumbers)).toEqual([[], [], []]);
  });

  it("follows the wizard: existing cities all stay, in order", () => {
    expect(planRestructure(days, config, [city("京都", 2), city("東京", 3)])).toMatchObject({ ok: false });
    expect(planRestructure(days, config, [city("東京", 3)])).toMatchObject({ ok: false });
    expect(planRestructure(days, config, [city("東京", 3), city("京都", 2), city("大阪", 2)])).toMatchObject({
      ok: false,
      problem: "行程裡沒有「大阪」",
    });
    expect(planRestructure(days, config, [city("東京", 3), city("京都", 2, true)])).toMatchObject({ ok: false });
  });

  it("keeps transit, return and booked days", () => {
    expect(planRestructure(days, config, [city("東京", 3), city("京都", 0)])).toMatchObject({ ok: false });
    const booked = days.map((d) => (d.id === "d2" ? { ...d, stops: [{ id: "e", name: "演唱會", fixedEvent: { type: "concert", startTime: "19:00" } }] } : d));
    const withEvent = { preferences: { fixedEvents: [{ type: "concert", date: "2026-12-02", startTime: "19:00" }] } };
    // 東京 down to 1 day would drop day 2's concert and its leaving day.
    expect(planRestructure(booked, withEvent, [city("東京", 1), city("京都", 2)])).toMatchObject({ ok: false });
    const plan = ok(planRestructure(booked, withEvent, [city("東京", 2), city("京都", 2)]));
    expect(plan.request.cities[0].keepDayIds).toEqual(["d2", "d3"]);
  });

  it("refuses a route that changes nothing or runs too long", () => {
    expect(planRestructure(days, config, [city("東京", 3), city("京都", 2)])).toMatchObject({ ok: false });
    expect(planRestructure(days, config, [city("東京", 3), city("京都", 99)])).toMatchObject({ ok: false });
  });
});

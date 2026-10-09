import { describe, expect, it } from "vitest";
import { buildDaySkeleton } from "@/lib/scheduler/buildDaySkeleton";
import type { StopCandidate } from "@/lib/scheduler/selectAndOrderStops";

// All on lat 0, spaced out along lng for unambiguous nearest-neighbor math.
const museum: StopCandidate = { id: "museum", lat: 0, lng: 0, rating: 4.9, type: "museum" };
const park: StopCandidate = { id: "park", lat: 0, lng: 0.1, rating: 4.0, type: "park" };
const restaurant: StopCandidate = {
  id: "restaurant",
  lat: 0,
  lng: 0.15,
  rating: 4.2,
  type: "restaurant",
};
const viewpoint: StopCandidate = { id: "viewpoint", lat: 0, lng: 0.2, rating: 3.5, type: "viewpoint" };
const pool = [museum, park, restaurant, viewpoint];

describe("buildDaySkeleton", () => {
  it("selects, orders, and schedules candidates in one pass", () => {
    const result = buildDaySkeleton(pool, { count: 3, pace: "intensive" });

    // Top 3 by rating are museum/restaurant/park; nearest-neighbor from
    // museum (the highest-scored, so also the default start) visits park
    // (closer) before restaurant.
    expect(result.map((s) => s.id)).toEqual(["museum", "park", "restaurant"]);

    expect(result[0]).toMatchObject({
      estimatedDurationMinutes: 90, // museum at intensive pace
      startMinute: 480,
      time_of_day: "morning",
      lat: 0,
      lng: 0,
    });
    expect(result[1]).toMatchObject({
      estimatedDurationMinutes: 60, // park at intensive pace
      startMinute: 575, // 570 + 5-minute intensive buffer
      time_of_day: "morning",
      lat: 0,
      lng: 0.1,
    });
    // restaurant is a default meal type, so it snaps forward to the lunch
    // window (12:00) instead of starting right after park at 10:40.
    expect(result[2]).toMatchObject({
      estimatedDurationMinutes: 60,
      startMinute: 12 * 60,
      time_of_day: "afternoon",
      lat: 0,
      lng: 0.15,
    });
  });

  it("orders from a custom origin instead of the highest-scored candidate", () => {
    const result = buildDaySkeleton(pool, { count: 3, origin: { lat: 0, lng: 0.12 } });
    expect(result.map((s) => s.id)).toEqual(["park", "restaurant", "museum"]);
  });

  it("only snaps configured meal types to the meal windows", () => {
    const result = buildDaySkeleton(pool, { count: 3, mealTypes: [], pace: "intensive" });
    const scheduledRestaurant = result.find((s) => s.id === "restaurant");

    // With mealTypes:[] the restaurant is treated as a plain stop, so it
    // continues sequentially right after park instead of snapping to lunch.
    expect(scheduledRestaurant).toMatchObject({
      startMinute: 640, // park ends 635 + 5-minute buffer
      time_of_day: "morning",
    });
  });

  it("attaches each selected candidate's real coordinates to its scheduled stop", () => {
    const result = buildDaySkeleton([museum, viewpoint], { count: 2 });
    for (const stop of result) {
      const source = pool.find((c) => c.id === stop.id);
      expect(stop.lat).toBe(source?.lat);
      expect(stop.lng).toBe(source?.lng);
    }
  });
});

// 室內行程為主: an outdoor stop shouldn't fall in the 11:00-15:00 sun.
describe("buildDaySkeleton for an indoor-first traveler", () => {
  const near = (id: string, type: string, lng: number): StopCandidate => ({ id, lat: 0, lng, rating: 4.5, type });
  const day = [near("museum", "museum", 0), near("park", "park", 0.001), near("mall", "shopping", 0.002)];

  // Plan 1.9: outdoor places go "in the morning or late afternoon" — a
  // 2.5-hour park from 9:00 may run to 11:30, but doesn't start at midday.
  it("starts the outdoor stop in the morning instead of mid-route", () => {
    const isOutdoor = (c: StopCandidate) => c.type === "park";
    const result = buildDaySkeleton(day, { count: 3, pace: "moderate", dayStartMinute: 9 * 60, origin: { lat: 0, lng: 0 }, isOutdoor });
    const park = result.find((s) => s.id === "park")!;
    expect(park.startMinute < 11 * 60 || park.startMinute >= 15 * 60).toBe(true);
    expect(result[0].id).toBe("park");
  });

  it("starts it after 15:00 for a late riser", () => {
    const isOutdoor = (c: StopCandidate) => c.type === "park";
    const result = buildDaySkeleton(day, { count: 3, pace: "moderate", dayStartMinute: 11 * 60, origin: { lat: 0, lng: 0 }, isOutdoor });
    expect(result[result.length - 1].id).toBe("park");
    expect(result[result.length - 1].startMinute).toBeGreaterThanOrEqual(15 * 60);
  });

  it("leaves the route as it was for everyone else", () => {
    const plain = buildDaySkeleton(day, { count: 3, pace: "moderate", dayStartMinute: 9 * 60, origin: { lat: 0, lng: 0 } });
    expect(plain.map((s) => s.id)).toEqual(["museum", "park", "mall"]);
  });
});

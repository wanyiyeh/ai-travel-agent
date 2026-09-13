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
    const result = buildDaySkeleton(pool, { count: 3 });

    // Top 3 by rating are museum/restaurant/park; nearest-neighbor from
    // museum (the highest-scored, so also the default start) visits park
    // (closer) before restaurant.
    expect(result.map((s) => s.id)).toEqual(["museum", "park", "restaurant"]);

    expect(result[0]).toMatchObject({
      estimatedDurationMinutes: 90, // museum type default
      startMinute: 480,
      time_of_day: "morning",
      lat: 0,
      lng: 0,
    });
    expect(result[1]).toMatchObject({
      estimatedDurationMinutes: 60, // park type default
      startMinute: 585,
      time_of_day: "morning",
      lat: 0,
      lng: 0.1,
    });
    // restaurant is a default meal type, so it snaps forward to the lunch
    // window (12:00) instead of starting right after park at 10:00.
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
    const result = buildDaySkeleton(pool, { count: 3, mealTypes: [] });
    const scheduledRestaurant = result.find((s) => s.id === "restaurant");

    // With mealTypes:[] the restaurant is treated as a plain stop, so it
    // continues sequentially right after park instead of snapping to lunch.
    expect(scheduledRestaurant).toMatchObject({
      startMinute: 660,
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

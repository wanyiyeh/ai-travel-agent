import { describe, expect, it } from "vitest";
import { dropExpiredCoords, dropExpiredDayCoords } from "@/lib/coordsPurge";

const cutoff = Date.parse("2026-09-23T00:00:00.000Z");
const fresh = "2026-10-01T00:00:00.000Z";
const expired = "2026-09-01T00:00:00.000Z";

describe("dropExpiredCoords", () => {
  it("drops coordinates fetched before the cutoff, keeping the place ID and our text", () => {
    const stop = { placeId: "ChIJ-a", lat: 1, lng: 2, coordsFetchedAt: expired, description: "寺廟。" };
    expect(dropExpiredCoords(stop, cutoff)).toBe(true);
    expect(stop).toEqual({ placeId: "ChIJ-a", description: "寺廟。" });
  });

  it("keeps coordinates fetched after the cutoff", () => {
    const stop = { placeId: "ChIJ-a", lat: 1, lng: 2, coordsFetchedAt: fresh };
    expect(dropExpiredCoords(stop, cutoff)).toBe(false);
    expect(stop).toMatchObject({ lat: 1, lng: 2 });
  });

  it("treats coordinates with no fetch time as expired: stored before times were recorded", () => {
    const stop = { placeId: "ChIJ-a", lat: 1, lng: 2 };
    expect(dropExpiredCoords(stop, cutoff)).toBe(true);
    expect(stop).not.toHaveProperty("lat");
  });

  it("leaves an item without a place ID alone: an airport's coordinates are ours", () => {
    const airport = { name: "成田機場", lat: 35.77, lng: 140.39 };
    expect(dropExpiredCoords(airport, cutoff)).toBe(false);
    expect(airport).toHaveProperty("lat");
  });

  it("reports no change for a place that already has no coordinates", () => {
    expect(dropExpiredCoords({ placeId: "ChIJ-a" }, cutoff)).toBe(false);
  });
});

describe("dropExpiredDayCoords", () => {
  it("covers stops, meals, lodging and the days kept for undo", () => {
    const old = () => ({ placeId: "ChIJ-x", lat: 1, lng: 2, coordsFetchedAt: expired });
    const day = {
      stops: [old(), { placeId: "ChIJ-y", lat: 3, lng: 4, coordsFetchedAt: fresh }],
      meals: { lunch: old() },
      accommodation: old(),
      _originalAfter: [{ stops: [old()] }],
    };

    expect(dropExpiredDayCoords(day, cutoff)).toBe(true);

    expect(day.stops[0]).not.toHaveProperty("lat");
    expect(day.stops[1]).toHaveProperty("lat", 3);
    expect(day.meals.lunch).not.toHaveProperty("lat");
    expect(day.accommodation).not.toHaveProperty("lat");
    expect(day._originalAfter[0].stops[0]).not.toHaveProperty("lat");
  });

  it("reports no change for a day with only fresh coordinates", () => {
    expect(dropExpiredDayCoords({ stops: [{ placeId: "ChIJ-y", lat: 3, lng: 4, coordsFetchedAt: fresh }] }, cutoff)).toBe(false);
  });
});

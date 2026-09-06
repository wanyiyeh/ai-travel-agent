import { describe, expect, it } from "vitest";
import {
  repairMissingAccommodation,
  repairTransitDayDepartureCities,
  resolveDayCoords,
  tagWaypointCities,
} from "@/lib/itineraryGen";

describe("resolveDayCoords", () => {
  it("returns the centroid of the day's own enriched stops when present", () => {
    const day = {
      stops: [
        { lat: 10, lng: 20 },
        { lat: 20, lng: 40 },
      ],
    };
    const coords = resolveDayCoords([day], day);
    expect(coords).toEqual({ lat: 15, lng: 30 });
  });

  it("falls back to sibling days sharing the same waypointCity when this day has no enriched stops", () => {
    const day = { waypointCity: "大阪", stops: [] };
    const sibling = {
      waypointCity: "大阪",
      stops: [{ lat: 34.0, lng: 135.0 }],
    };
    const otherCitySibling = {
      waypointCity: "東京",
      stops: [{ lat: 0, lng: 0 }],
    };
    const coords = resolveDayCoords([day, sibling, otherCitySibling], day);
    expect(coords).toEqual({ lat: 34.0, lng: 135.0 });
  });

  it("falls back to the day's own city centre via cityToIata when nothing is geocoded yet", () => {
    // No enriched stops anywhere, but waypointCity ("東京") resolves through
    // cityToIata -> NRT -> IATA_COORDS. This is the fix for a later-leg day
    // (e.g. day 3 in Nagoya on a Tokyo-arrival trip) no longer searching
    // around the flight's arrival city by mistake.
    const day = { waypointCity: "東京", stops: [] };
    const coords = resolveDayCoords([day], day, "KIX");
    expect(coords).toEqual({ lat: 35.6762, lng: 139.6503 });
  });

  it("falls back to the flight's arrival IATA code when the city can't be resolved", () => {
    const day = { waypointCity: "不存在的城市", stops: [] };
    const coords = resolveDayCoords([day], day, "KIX");
    expect(coords).toEqual({ lat: 34.6937, lng: 135.5023 });
  });

  it("returns null when nothing can be resolved", () => {
    const day = { stops: [] };
    expect(resolveDayCoords([day], day)).toBeNull();
  });
});

describe("tagWaypointCities", () => {
  it("carries the current city forward across non-transit days", () => {
    const days = [{}, {}];
    const tagged = tagWaypointCities(days, "東京");
    expect(tagged.map((d) => d.waypointCity)).toEqual(["東京", "東京"]);
  });

  it("tags a transit day with its departure city, then switches currentCity to transitTo", () => {
    const days = [
      {}, // day 1, still in 東京
      { isTransitDay: true, transitTo: "大阪" }, // day 2, transit
      {}, // day 3, now in 大阪
    ];
    const tagged = tagWaypointCities(days, "東京");
    expect(tagged.map((d) => d.waypointCity)).toEqual(["東京", "東京", "大阪"]);
  });

  it("trusts an explicitly declared waypointCity for progressive multi-segment routes", () => {
    const days = [
      {}, // 東京
      { isTransitDay: true, transitTo: "京都" },
      { waypointCity: "京都" }, // declared explicitly
      { isTransitDay: true, transitTo: "大阪" },
      {}, // 大阪
    ];
    const tagged = tagWaypointCities(days, "東京");
    expect(tagged.map((d) => d.waypointCity)).toEqual(["東京", "東京", "京都", "京都", "大阪"]);
  });
});

describe("repairTransitDayDepartureCities", () => {
  it("rewrites a transit stop that names the wrong departure city", () => {
    const days = [
      {
        isTransitDay: true,
        transitTo: "大阪",
        waypointCity: "東京",
        stops: [
          {
            name: "搭乘火車從京都前往大阪",
            description: "從京都出發，車程約2小時",
          },
        ],
      },
    ];
    const [repaired] = repairTransitDayDepartureCities(days);
    expect(repaired.stops[0].name).toBe("搭乘火車從東京前往大阪");
    expect(repaired.stops[0].description).toBe("從東京出發，車程約2小時");
  });

  it("leaves a transit stop untouched when it already names the correct departure city", () => {
    const days = [
      {
        isTransitDay: true,
        transitTo: "大阪",
        waypointCity: "東京",
        stops: [
          {
            name: "搭乘火車從東京前往大阪",
            description: "從東京出發，車程約2小時",
          },
        ],
      },
    ];
    const [repaired] = repairTransitDayDepartureCities(days);
    expect(repaired.stops[0].name).toBe("搭乘火車從東京前往大阪");
  });

  it("leaves non-transit days untouched", () => {
    const days = [
      {
        isTransitDay: false,
        waypointCity: "東京",
        stops: [{ name: "淺草寺", description: "從京都出發的錯誤描述" }],
      },
    ];
    const [repaired] = repairTransitDayDepartureCities(days);
    expect(repaired.stops[0].name).toBe("淺草寺");
    expect(repaired.stops[0].description).toBe("從京都出發的錯誤描述");
  });
});

describe("repairMissingAccommodation", () => {
  it("carries forward the nearest earlier day's accommodation when one is missing", () => {
    const days = [
      { day: 1, accommodation: { name: "東京飯店" } },
      { day: 2, accommodation: null },
      { day: 3, accommodation: { name: "大阪飯店" } },
    ];
    const repaired = repairMissingAccommodation(days);
    expect(repaired[1].accommodation).toEqual({ name: "東京飯店" });
    // Untouched days keep their own reference/value
    expect(repaired[0].accommodation).toEqual({ name: "東京飯店" });
    expect(repaired[2].accommodation).toEqual({ name: "大阪飯店" });
  });

  it("does not touch the last day even when it has no accommodation", () => {
    const days = [
      { day: 1, accommodation: { name: "東京飯店" } },
      { day: 2, accommodation: null },
    ];
    const repaired = repairMissingAccommodation(days);
    expect(repaired[1].accommodation).toBeNull();
  });

  it("does not touch a transit day even when it has no accommodation", () => {
    const days = [
      { day: 1, accommodation: { name: "東京飯店" } },
      { day: 2, isTransitDay: true, accommodation: null },
      { day: 3, accommodation: { name: "大阪飯店" } },
    ];
    const repaired = repairMissingAccommodation(days);
    expect(repaired[1].accommodation).toBeNull();
  });

  it("leaves a missing day as-is when no earlier day has accommodation to reuse", () => {
    const days = [
      { day: 1, accommodation: null },
      { day: 2, accommodation: { name: "大阪飯店" } },
    ];
    const repaired = repairMissingAccommodation(days);
    expect(repaired[0].accommodation).toBeNull();
  });
});

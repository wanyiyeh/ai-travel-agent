import { describe, expect, it } from "vitest";
import { stripCandidates, stripDay, stripJsonField, stripStop } from "@/lib/placeStorage";

const googleStop = {
  id: "s1",
  name: "淺草寺",
  description: "東京最古老的寺廟。",
  duration_minutes: 90,
  time_of_day: "morning",
  transport_from_prev: "步行約 10 分鐘",
  estimated_cost: 0,
  district: "淺草",
  placeId: "ChIJ-sensoji",
  lat: 35.7148,
  lng: 139.7967,
  address: "2 Chome-3-1 Asakusa, Taito City, Tokyo",
  rating: 4.5,
  openingHours: "6:00–17:00",
  photoName: "places/ChIJ-sensoji/photos/abc",
};

describe("stripStop", () => {
  it("keeps the place ID, coordinates and our own text, drops Google's name, address, rating, hours and photo", () => {
    expect(stripStop(googleStop)).toEqual({
      id: "s1",
      description: "東京最古老的寺廟。",
      duration_minutes: 90,
      time_of_day: "morning",
      transport_from_prev: "步行約 10 分鐘",
      estimated_cost: 0,
      district: "淺草",
      placeId: "ChIJ-sensoji",
      lat: 35.7148,
      lng: 139.7967,
      coordsFetchedAt: expect.any(String),
    });
  });

  // ADR-0006: the 30-day purge needs to know when every coordinate was fetched.
  it("stamps coordinates that arrive without a fetch time with now", () => {
    const before = Date.now();
    const { coordsFetchedAt } = stripStop(googleStop) as { coordsFetchedAt: string };
    expect(Date.parse(coordsFetchedAt)).toBeGreaterThanOrEqual(before);
  });

  it("keeps a fetch time already there, so rewriting an old day doesn't make it look new", () => {
    const old = "2026-09-01T00:00:00.000Z";
    expect(stripStop({ ...googleStop, coordsFetchedAt: old })).toMatchObject({ coordsFetchedAt: old });
  });

  it("drops a fetch time left without coordinates", () => {
    const noCoords = { ...googleStop, lat: undefined, lng: undefined, coordsFetchedAt: "2026-09-01T00:00:00.000Z" };
    expect(stripStop(noCoords)).not.toHaveProperty("coordsFetchedAt");
  });

  it("keeps the name of a stop with no place ID: it's the model's or the traveler's own words", () => {
    const ride = { id: "t", name: "搭乘新幹線前往京都", description: "約 2 小時 15 分", duration_minutes: 135 };
    expect(stripStop(ride)).toEqual(ride);
  });

  it("keeps the name of a 固定行程, which the traveler typed", () => {
    const concert = { ...googleStop, fixedEvent: { type: "concert", startTime: "18:00", endTime: "21:00" } };
    expect(stripStop(concert)).toMatchObject({ name: "淺草寺", fixedEvent: concert.fixedEvent });
  });

  it("drops a field it doesn't know, so new Google data can't slip in", () => {
    expect(stripStop({ ...googleStop, websiteUri: "https://example.com" })).not.toHaveProperty("websiteUri");
  });
});

describe("stripDay", () => {
  const day = {
    id: "d1",
    day: 1,
    theme: "下町散步",
    waypointCity: "東京",
    weatherNote: "日落約 16:30",
    stops: [googleStop],
    meals: {
      lunch: { name: "大黑家天麩羅", placeId: "ChIJ-daikokuya", lat: 35.71, lng: 139.79, address: "Asakusa", rating: 4.2, description: "天丼名店。", estimated_cost: 2000, photoName: "p" },
    },
    accommodation: {
      name: "Hotel Gracery",
      area: "新宿",
      reason: "交通方便",
      placeId: "ChIJ-gracery",
      lat: 35.69,
      lng: 139.70,
      address: "Kabukicho",
      rating: 4.1,
      priceLevel: 3,
      nearestStation: { name: "新宿", distanceMeters: 400 },
      photoName: "p",
    },
  };

  it("strips every stop, meal and the lodging, and keeps the day's own fields", () => {
    const stripped = stripDay(day) as typeof day;
    expect(stripped).toMatchObject({ id: "d1", day: 1, theme: "下町散步", waypointCity: "東京", weatherNote: "日落約 16:30" });
    expect(stripped.stops[0]).not.toHaveProperty("name");
    expect(stripped.meals.lunch).toEqual({ placeId: "ChIJ-daikokuya", lat: 35.71, lng: 139.79, coordsFetchedAt: expect.any(String), description: "天丼名店。", estimated_cost: 2000 });
    expect(stripped.accommodation).toEqual({ area: "新宿", reason: "交通方便", placeId: "ChIJ-gracery", lat: 35.69, lng: 139.70, coordsFetchedAt: expect.any(String) });
  });

  it("also strips the days remove-waypoint keeps for undo", () => {
    const stripped = stripDay({ ...day, _originalAfter: [day] }) as { _originalAfter: (typeof day)[] };
    expect(stripped._originalAfter[0].stops[0]).not.toHaveProperty("address");
  });

  it("doesn't change the day it was given", () => {
    stripDay(day);
    expect(day.stops[0]).toHaveProperty("address");
  });
});

describe("stripCandidates", () => {
  it("strips each candidate and keeps the picker's own flags", () => {
    const [candidate] = stripCandidates([{ ...googleStop, isCurrent: true }]) as Record<string, unknown>[];
    expect(candidate).toMatchObject({ placeId: "ChIJ-sensoji", isCurrent: true });
    expect(candidate).not.toHaveProperty("rating");
  });
});

describe("stripJsonField", () => {
  it("returns a string for a string and an object for an object", () => {
    const asString = stripJsonField(JSON.stringify(googleStop), stripStop);
    expect(typeof asString).toBe("string");
    expect(JSON.parse(asString as string)).not.toHaveProperty("address");
    expect(stripJsonField(googleStop, stripStop)).not.toHaveProperty("address");
  });
});

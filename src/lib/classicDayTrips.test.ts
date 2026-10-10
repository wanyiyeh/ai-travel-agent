import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

const createMock = vi.fn();
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
}));
const findUniqueMock = vi.fn();
const upsertMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    classicDayTripCache: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
  },
}));
const textSearchMock = vi.fn();
vi.mock("@/lib/fetchCityRestaurants", () => ({
  searchTextCandidates: (...args: unknown[]) => textSearchMock(...args),
}));
const cityCenterMock = vi.fn();
vi.mock("@/lib/placesTextSearch", () => ({
  getCityCenter: (...args: unknown[]) => cityCenterMock(...args),
}));

const { byInterest, classicTripEvents, findClassicDayTrip, listClassicDayTrips, travelMinutes } = await import("@/lib/classicDayTrips");

const tokyo = { lat: 35.6812, lng: 139.7671 };
const towns: Record<string, { lat: number; lng: number }> = {
  鎌倉: { lat: 35.3192, lng: 139.5467 }, // ~45km straight-line, ~1 hour by train
  箱根: { lat: 35.2324, lng: 139.1069 }, // ~78km
  日光: { lat: 36.7199, lng: 139.6982 }, // ~116km
  横浜: { lat: 35.4437, lng: 139.638 }, // ~29km: not out of town
};
const sight = (placeId: string, at: { lat: number; lng: number }): PlaceCandidate => ({
  name: placeId,
  placeId,
  lat: at.lat + 0.005,
  lng: at.lng,
  address: "",
  types: ["tourist_attraction"],
});

const aiReturns = (json: unknown) =>
  createMock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(json) } }] });
const list = {
  trips: [
    { town: "横浜", sights: ["山下公園", "中華街"], interests: ["food"] },
    { town: "箱根", sights: ["箱根神社", "大涌谷", "蘆之湖"], interests: ["nature"] },
    { town: "日光", sights: ["日光東照宮", "華嚴瀑布"], interests: ["culture", "nature"] },
  ],
};

beforeEach(() => {
  createMock.mockReset();
  findUniqueMock.mockReset();
  upsertMock.mockReset();
  textSearchMock.mockReset();
  cityCenterMock.mockReset();
  findUniqueMock.mockResolvedValue(null);
  cityCenterMock.mockImplementation(async (town: string) => towns[town] ?? null);
  textSearchMock.mockImplementation(async (name: string, center: { lat: number; lng: number }) => [sight(name, center)]);
});

describe("listClassicDayTrips", () => {
  it("asks for towns 1-2 hours out, and caches the answer per city", async () => {
    aiReturns(list);

    const result = await listClassicDayTrips("東京", "m");

    expect(result?.trips.map((t) => t.town)).toEqual(["横浜", "箱根", "日光"]);
    expect(createMock.mock.calls[0][0].messages[0].content).toContain("40～150 km");
    expect(upsertMock.mock.calls[0][0].where).toEqual({ city: "東京" });
  });

  it("serves the cache without asking again, and doesn't cache a failure", async () => {
    findUniqueMock.mockResolvedValueOnce({ list: JSON.stringify(list) });
    expect((await listClassicDayTrips("東京", "m"))?.trips).toHaveLength(3);
    expect(createMock).not.toHaveBeenCalled();

    createMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await listClassicDayTrips("大阪", "m")).toBeUndefined();
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe("byInterest", () => {
  it("puts towns that suit the traveler first, otherwise keeps the most famous first", () => {
    expect(byInterest(list.trips, ["culture"]).map((t) => t.town)).toEqual(["日光", "横浜", "箱根"]);
    expect(byInterest(list.trips, []).map((t) => t.town)).toEqual(["横浜", "箱根", "日光"]);
  });
});

describe("findClassicDayTrip", () => {
  it("takes 鎌倉, under 50km as the crow flies but an hour by train", async () => {
    findUniqueMock.mockResolvedValue({ list: JSON.stringify({ trips: [{ town: "鎌倉", sights: ["鶴岡八幡宮", "鎌倉大佛"], interests: [] }] }) });

    expect((await findClassicDayTrip("東京", tokyo, "key", [], "m", new Set()))?.town).toBe("鎌倉");
  });

  it("skips a town too close to count as a day out, and confirms the sights of the next", async () => {
    findUniqueMock.mockResolvedValue({ list: JSON.stringify(list) });

    const trip = await findClassicDayTrip("東京", tokyo, "key", [], "m", new Set());

    expect(trip?.town).toBe("箱根");
    expect(trip?.km).toBeGreaterThan(70);
    expect(trip?.sights.map((s) => s.placeId)).toEqual(["箱根神社", "大涌谷", "蘆之湖"]);
    expect(textSearchMock.mock.calls[0].slice(0, 4)).toEqual(["箱根神社", towns["箱根"], "key", 15000]);
  });

  it("skips a town the route already stays in", async () => {
    findUniqueMock.mockResolvedValue({ list: JSON.stringify(list) });

    const trip = await findClassicDayTrip("東京", tokyo, "key", [], "m", new Set(), async (town) => town !== towns["箱根"]);

    expect(trip?.town).toBe("日光");
  });

  it("needs at least 2 sights found, each in season", async () => {
    findUniqueMock.mockResolvedValue({ list: JSON.stringify({ trips: [list.trips[1]] }) });

    const trip = await findClassicDayTrip("東京", tokyo, "key", [], "m", new Set(), undefined, async (p) => p.placeId === "箱根神社");

    expect(trip).toBeUndefined();
  });

  it("doesn't take a sight found far from the town", async () => {
    findUniqueMock.mockResolvedValue({ list: JSON.stringify({ trips: [list.trips[2]] }) });
    textSearchMock.mockImplementation(async (name: string) => [sight(name, name === "華嚴瀑布" ? tokyo : towns["日光"])]);

    expect(await findClassicDayTrip("東京", tokyo, "key", [], "m", new Set())).toBeUndefined();
  });
});

describe("classicTripEvents", () => {
  const hakone = { town: "箱根", km: 78, sights: ["箱根神社", "大涌谷", "蘆之湖"].map((n) => sight(n, towns["箱根"])) };

  it("fills the day with back-to-back blocks, so the city gets no stops", () => {
    const events = classicTripEvents(hakone, "東京", 9 * 60, 18 * 60, false);

    expect(events[0].block.startMinute).toBe(9 * 60);
    expect(events.at(-1)!.block.endMinute).toBe(18 * 60);
    for (let i = 1; i < events.length; i++) expect(events[i].block.startMinute).toBe(events[i - 1].block.endMinute);
  });

  it("says how to get there and back", () => {
    const events = classicTripEvents(hakone, "東京", 9 * 60, 18 * 60, false);

    expect(events[0].stop?.description).toContain("從東京搭火車約 1.5 小時到箱根");
    expect(events.at(-1)!.stop?.description).toContain("傍晚搭火車回東京");
    expect(classicTripEvents(hakone, "東京", 9 * 60, 18 * 60, true)[0].stop?.description).toContain("開車");
  });

  it("drops a sight that doesn't fit after a long ride out, keeping two", () => {
    const nikko = { ...hakone, town: "日光", km: 140 };
    expect(classicTripEvents(nikko, "東京", 9 * 60, 18 * 60, false)).toHaveLength(2);
  });

  it("puts a ride's worth of time before the first sight", () => {
    expect(travelMinutes(30)).toBe(45);
    expect(travelMinutes(78)).toBe(78);
    expect(travelMinutes(200)).toBe(150);
    expect(classicTripEvents(hakone, "東京", 9 * 60, 18 * 60, false)[0].stop?.time_of_day).toBe("morning");
  });
});

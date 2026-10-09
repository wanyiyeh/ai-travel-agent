import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

const nearbyMock = vi.fn();
vi.mock("@/lib/fetchCityRestaurants", () => ({
  fetchNearbyPlaceCandidates: (...args: unknown[]) => nearbyMock(...args),
}));

const { findSuburbPlace, isInOtherCity, suburbDayIndex, suburbGroupsFor, suburbKindFor, suburbTripEvent } = await import("@/lib/suburbTrips");

// Sapporo; 支笏湖 is about 40km out, 円山公園 in town.
const sapporo = { lat: 43.0618, lng: 141.3545 };
const place = (placeId: string, lat: number, lng: number, types: string[] = ["national_park"]): PlaceCandidate => ({
  name: placeId,
  placeId,
  lat,
  lng,
  address: "",
  types,
});
const shikotsu = place("支笏湖", 42.7718, 141.3297);
const maruyama = place("円山公園", 43.0539, 141.3195, ["park"]);

beforeEach(() => {
  nearbyMock.mockReset();
});

describe("suburbGroupsFor", () => {
  it("follows the traveler's interests and drinks", () => {
    expect(suburbGroupsFor(["water", "food"], ["alcohol"])).toEqual(["water", "food", "alcohol"]);
  });

  it("counts the old 冒險戶外 as land", () => {
    expect(suburbGroupsFor(["adventure"])).toEqual(["land"]);
  });

  it("goes for the outdoors when nothing points elsewhere", () => {
    expect(suburbGroupsFor(["culture"])).toEqual(["land", "water"]);
  });
});

describe("suburbKindFor", () => {
  // By car or by train alike.
  it.each([
    [4, "day"],
    [3, "day"],
    [2, "half"],
    [1, undefined],
  ] as const)("%i sightseeing days: %s", (days, kind) => {
    expect(suburbKindFor(days)).toBe(kind);
  });
});

describe("findSuburbPlace", () => {
  it("takes a place out of town, not one downtown", async () => {
    nearbyMock.mockResolvedValue([maruyama, shikotsu]);
    const found = await findSuburbPlace(sapporo, "key", ["land"], 50, new Set());
    expect(found?.place.placeId).toBe("支笏湖");
  });

  it("stays within the trip's reach", async () => {
    nearbyMock.mockResolvedValue([shikotsu]);
    expect(await findSuburbPlace(sapporo, "key", ["land"], 30, new Set())).toBeUndefined();
  });

  it("skips places the trip already uses", async () => {
    nearbyMock.mockResolvedValue([shikotsu]);
    expect(await findSuburbPlace(sapporo, "key", ["land"], 50, new Set(["支笏湖"]))).toBeUndefined();
  });

  it("only takes a farm Google also calls a tourist attraction", async () => {
    const privateFarm = place("Private Farm", 42.8, 141.4, ["farm"]);
    const openFarm = place("Farm Tomita", 42.8, 141.5, ["farm", "tourist_attraction"]);
    nearbyMock.mockResolvedValue([privateFarm, openFarm]);
    const found = await findSuburbPlace(sapporo, "key", ["food"], 50, new Set());
    expect(found?.place.placeId).toBe("Farm Tomita");
  });

  it("skips a place out of season for the next one", async () => {
    const skiResort = place("Sapporo Kokusai", 43.08, 141.1, ["ski_resort"]);
    nearbyMock.mockResolvedValue([skiResort, shikotsu]);
    const accept = vi.fn(async (p: PlaceCandidate) => !p.types?.includes("ski_resort"));

    const found = await findSuburbPlace(sapporo, "key", ["land"], 50, new Set(), accept);

    expect(found?.place.placeId).toBe("支笏湖");
    expect(accept).toHaveBeenCalledTimes(2); // only the places reached
  });

  it("searches each interest on its own, so one rejected search doesn't sink the rest", async () => {
    nearbyMock.mockImplementation(async (_c: unknown, _k: unknown, types: string[]) => {
      if (types.includes("winery")) throw new Error("400");
      return [shikotsu];
    });
    const found = await findSuburbPlace(sapporo, "key", ["alcohol", "land"], 50, new Set());
    expect(nearbyMock).toHaveBeenCalledTimes(2);
    expect(found?.group).toBe("land");
  });
});

describe("isInOtherCity", () => {
  const otaru = { lat: 43.19, lng: 141.0 };

  it("catches a place in a town the route already stays in", () => {
    expect(isInOtherCity({ lat: 43.186, lng: 141.023 }, [otaru])).toBe(true); // Otaru Port Marina
    expect(isInOtherCity(shikotsu, [otaru])).toBe(false);
    expect(isInOtherCity(shikotsu, [])).toBe(false);
  });
});

describe("suburbTripEvent", () => {
  it("fills a day trip's whole day, so no city stops are added", () => {
    const { block } = suburbTripEvent(shikotsu, "land", "day", 9 * 60, 18 * 60, true);
    expect(block).toEqual({ startMinute: 540, endMinute: 1080 });
  });

  it("leaves a half day's afternoon to the city", () => {
    const { block } = suburbTripEvent(shikotsu, "land", "half", 9 * 60, 18 * 60, false);
    expect(block.endMinute).toBe(9 * 60 + 150 + 60);
  });

  it("says how to get there", () => {
    expect(suburbTripEvent(shikotsu, "land", "day", 540, 1080, true).stop?.description).toContain("開車前往");
    expect(suburbTripEvent(shikotsu, "land", "day", 540, 1080, false).stop?.description).toContain("搭火車或巴士當天往返");
  });

  it("reminds a driver at a winery not to taste", () => {
    const winery = place("Winery", 42.9, 141.5, ["winery"]);
    expect(suburbTripEvent(winery, "alcohol", "day", 540, 1080, true).stop?.description).toContain("不能試飲");
    expect(suburbTripEvent(winery, "alcohol", "half", 540, 1080, false).stop?.description).not.toContain("不能試飲");
  });
});

describe("suburbDayIndex", () => {
  it("picks the first day after the first that has no fixed events", () => {
    expect(suburbDayIndex([0, 1, 0, 0])).toBe(2);
  });

  it("has no day when every later day is booked", () => {
    expect(suburbDayIndex([0, 1])).toBeUndefined();
  });
});

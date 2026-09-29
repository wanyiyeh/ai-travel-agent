import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { fetchNearbyPlaceCandidates } from "./fetchCityRestaurants";

// Story: one generation asks for the same city's attractions with different
// counts (transit day, sightseeing days, departure day). Nearby Search bills
// per request, so they should share one fetched-and-cached pool.
describe("fetchNearbyPlaceCandidates shares one pool across counts", () => {
  // Unique per run so rows from an earlier run can't answer these calls.
  const coords = { lat: 30 + (Date.now() % 100000) / 1e6, lng: 40 };
  const places = Array.from({ length: 20 }, (_, i) => ({
    id: `place-${i}`,
    displayName: { text: `Place ${i}` },
    location: { latitude: coords.lat, longitude: coords.lng },
  }));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.nearbyPlaceCandidatesCache.deleteMany({
      where: { cacheKey: { startsWith: `${coords.lat.toFixed(4)},` } },
    });
  });

  it("fetches the max once, then slices every count from the cache", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const small = await fetchNearbyPlaceCandidates(coords, "key", ["tourist_attraction"], 10000, 6);
    const large = await fetchNearbyPlaceCandidates(coords, "key", ["tourist_attraction"], 10000, 14);

    expect(small.map((c) => c.placeId)).toEqual(places.slice(0, 6).map((p) => p.id));
    expect(large.map((c) => c.placeId)).toEqual(places.slice(0, 14).map((p) => p.id));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.maxResultCount).toBe(20);
  });
});

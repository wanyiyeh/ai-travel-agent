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

// Story: Google bills a whole request at the tier of its most expensive field
// (plan/form-preference-wiring.md 1c-2). Only lunch/dinner pays for
// Enterprise; everything else must stay on Pro, and a Pro caller should reuse
// an Enterprise pool rather than pay for the same places again.
describe("fetchNearbyPlaceCandidates billing tiers", () => {
  const coords = { lat: 31 + (Date.now() % 100000) / 1e6, lng: 41 };
  const places = [
    {
      id: "p1",
      displayName: { text: "Place 1" },
      location: { latitude: coords.lat, longitude: coords.lng },
      rating: 4.4,
      priceRange: { startPrice: { currencyCode: "JPY", units: "1000" }, endPrice: { currencyCode: "JPY", units: "2000" } },
    },
  ];
  const request = (fetchMock: ReturnType<typeof vi.fn>, i = 0) =>
    (fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1];
  const maskOf = (init: RequestInit) => new Headers(init.headers).get("X-Goog-FieldMask") ?? "";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.nearbyPlaceCandidatesCache.deleteMany({
      where: { cacheKey: { startsWith: `${coords.lat.toFixed(4)},` } },
    });
  });

  it("asks only for Pro fields by default, and never sends the ignored priceLevels filter", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchNearbyPlaceCandidates(coords, "key", ["museum"], 5000, 10);

    const init = request(fetchMock);
    for (const enterpriseField of ["rating", "priceLevel", "priceRange"]) {
      expect(maskOf(init)).not.toContain(enterpriseField);
    }
    expect(JSON.parse(init.body as string)).not.toHaveProperty("priceLevels");
  });

  it("asks for priceRange on an Enterprise search and parses it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const [place] = await fetchNearbyPlaceCandidates(coords, "key", ["restaurant"], 5000, 10, "enterprise");

    expect(maskOf(request(fetchMock))).toContain("places.priceRange");
    expect(place.priceRange).toEqual({ currency: "JPY", start: 1000, end: 2000 });
    expect(place.rating).toBe(4.4);
  });

  it("lets a Pro search reuse a cached Enterprise pool instead of paying again", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchNearbyPlaceCandidates(coords, "key", ["cafe"], 5000, 10, "enterprise");
    const fromPro = await fetchNearbyPlaceCandidates(coords, "key", ["cafe"], 5000, 10, "pro");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fromPro.map((c) => c.placeId)).toEqual(["p1"]);
  });

  it("does not let an Enterprise search reuse a Pro pool, which lacks price data", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchNearbyPlaceCandidates(coords, "key", ["bakery"], 5000, 10, "pro");
    await fetchNearbyPlaceCandidates(coords, "key", ["bakery"], 5000, 10, "enterprise");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { fetchLodgingCandidates, fetchLuxuryRestaurants, fetchNearbyPlaceCandidates } from "./fetchCityRestaurants";

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

// Story: a luxury trip should get Hilton/Marriott-tier hotels. Brand matching
// works on the normal lodging search; only a city with no brand hotel or
// resort at all is worth one extra "luxury hotel" Text Search.
describe("fetchLodgingCandidates for the luxury tier", () => {
  const coords = { lat: 32 + (Date.now() % 100000) / 1e6, lng: 42 };
  const hotel = (id: string, name: string, types = ["hotel"]) => ({
    id,
    displayName: { text: name },
    location: { latitude: coords.lat, longitude: coords.lng },
    types,
  });
  const urls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.nearbyPlaceCandidatesCache.deleteMany({
      where: {
        OR: [
          { cacheKey: { startsWith: `${coords.lat.toFixed(4)},` } },
          { cacheKey: { startsWith: `text:luxury hotel@${coords.lat.toFixed(4)},` } },
        ],
      },
    });
  });

  it("puts brand hotels first without an extra search when the pool has one", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ places: [hotel("a", "Budget Inn"), hotel("b", "東京希爾頓酒店")] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLodgingCandidates(coords, "key", "luxury", 3000, 10);

    expect(result.map((p) => p.placeId)).toEqual(["b", "a"]);
    expect(urls(fetchMock).every((u) => u.includes("searchNearby"))).toBe(true);
  });

  it("adds a Pro-tier 'luxury hotel' Text Search when the pool has no brand or resort", async () => {
    const otherCoords = { lat: coords.lat, lng: 43 };
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("searchText")
        ? new Response(JSON.stringify({ places: [hotel("lux", "Grand Local Palace")] }), { status: 200 })
        : new Response(JSON.stringify({ places: [hotel("a", "Budget Inn")] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLodgingCandidates(otherCoords, "key", "luxury", 3000, 10);

    expect(result.map((p) => p.placeId)).toEqual(["lux", "a"]);
    const textCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("searchText")) as unknown as [string, RequestInit];
    const mask = new Headers(textCall[1].headers).get("X-Goog-FieldMask") ?? "";
    expect(mask).not.toMatch(/rating|priceLevel|priceRange/);
  });
});

// Story: a luxury trip's lunches and dinners were all casual ramen and curry,
// because the popularity-ranked Nearby pool barely has expensive places.
describe("fetchLuxuryRestaurants", () => {
  const coords = { lat: 33 + (Date.now() % 100000) / 1e6, lng: 44 };
  const request = (fetchMock: ReturnType<typeof vi.fn>) => (fetchMock.mock.calls[0] as unknown as [string, RequestInit]);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.nearbyPlaceCandidatesCache.deleteMany({
      where: { cacheKey: { startsWith: `text:restaurant@${coords.lat.toFixed(4)},` } },
    });
  });

  it("filters by expensive price levels server-side and reads prices back", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          places: [
            {
              id: "kaiseki",
              displayName: { text: "Kaiseki" },
              location: { latitude: coords.lat, longitude: coords.lng },
              priceRange: { startPrice: { currencyCode: "JPY", units: "8000" }, endPrice: { currencyCode: "JPY", units: "15000" } },
            },
          ],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const [place] = await fetchLuxuryRestaurants(coords, "key", 3000);

    const [url, init] = request(fetchMock);
    expect(url).toContain("places:searchText");
    expect(JSON.parse(init.body as string).priceLevels).toEqual(["PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"]);
    expect(new Headers(init.headers).get("X-Goog-FieldMask")).toContain("places.priceRange");
    expect(place.priceRange).toEqual({ currency: "JPY", start: 8000, end: 15000 });

    // cached: a second call doesn't pay again
    await fetchLuxuryRestaurants(coords, "key", 3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getCityCenter } from "./placesTextSearch";

// Story: a day's waypointCity is something Google can't resolve as a city.
// Every page open's auto-enrich calls getCityCenter for it — a confirmed
// "not found" must be remembered, but an API error must not be.
describe("getCityCenter remembers confirmed misses", () => {
  const missing = `Nowhere City ${Date.now()}`;
  const erroring = `Erroring City ${Date.now()}`;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.cityCenterMissCache.deleteMany({ where: { cityName: { in: [missing, erroring] } } });
  });

  it("looks a city that doesn't exist up once (as a city, then unrestricted), then answers from the miss cache", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getCityCenter(missing, "key")).toBeNull();
    expect(await getCityCenter(missing, "key")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a Places API error, so the next call retries", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getCityCenter(erroring, "key")).toBeNull();
    expect(await getCityCenter(erroring, "key")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once the miss is older than the TTL", async () => {
    await prisma.cityCenterMissCache.update({
      where: { cityName: missing },
      data: { updatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getCityCenter(missing, "key");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// Story: a trip to Barcelona was searched around a bar in Taipei — the
// unrestricted lookup matched 巴賽隆納俱樂部 — and Tokyo trips were centred on
// residential Suginami, Google's point for the whole metropolis.
describe("getCityCenter finds where a visitor actually stays", () => {
  const city = `Lookup City ${Date.now()}`;
  const region = `Lookup Region ${Date.now()}`;
  const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, i: number) =>
    JSON.parse(((fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].body as string));
  const at = (lat: number, lng: number) =>
    new Response(JSON.stringify({ places: [{ id: "p", displayName: { text: "x" }, formattedAddress: "a", location: { latitude: lat, longitude: lng } }] }), { status: 200 });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.placeQuery.deleteMany({ where: { query: { in: [`city-center:v2:${city}`, `city-center:v2:${region}`] } } });
  });

  it("asks for a city (locality) first", async () => {
    const fetchMock = vi.fn(async () => at(41.38, 2.17));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getCityCenter(city, "key")).toEqual({ lat: 41.38, lng: 2.17 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock, 0)).toMatchObject({ includedType: "locality", strictTypeFiltering: true });
  });

  it("falls back to an unrestricted search for a region that isn't a city", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ places: [] }), { status: 200 }))
      .mockResolvedValueOnce(at(29.5, 34));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getCityCenter(region, "key")).toEqual({ lat: 29.5, lng: 34 });
    expect(bodyOf(fetchMock, 1)).not.toHaveProperty("includedType");
  });

  it("uses the downtown for names Google resolves to a whole metropolis or prefecture, without a lookup", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await getCityCenter("東京", "key")).toEqual({ lat: 35.6812, lng: 139.7671 });
    expect(await getCityCenter("沖繩", "key")).toEqual({ lat: 26.2124, lng: 127.6809 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

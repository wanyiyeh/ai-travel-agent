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

  it("queries Google once for a city that doesn't exist, then answers from the miss cache", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getCityCenter(missing, "key")).toBeNull();
    expect(await getCityCenter(missing, "key")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

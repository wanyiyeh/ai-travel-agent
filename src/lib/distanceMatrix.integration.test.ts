import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getDistance } from "./distanceMatrix";

// Story: two stops in a small town have no transit coverage. Every generation
// that schedules that leg asks Routes for a transit route first — a confirmed
// "no route" must be remembered, but an API error must not be.
describe("getDistance remembers confirmed no-route results", () => {
  // Unique per run so rows from an earlier run can't answer these calls.
  const offset = (Date.now() % 100000) / 1e6;
  const noRouteOrigin = { lat: 10 + offset, lng: 20 };
  const erroringOrigin = { lat: 11 + offset, lng: 20 };
  const destination = { lat: 12 + offset, lng: 20 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.distanceCache.deleteMany({
      where: { cacheKey: { startsWith: `${noRouteOrigin.lat.toFixed(4)},` } },
    });
    await prisma.distanceCache.deleteMany({
      where: { cacheKey: { startsWith: `${erroringOrigin.lat.toFixed(4)},` } },
    });
  });

  it("queries Routes once for a leg with no route, then answers from the cache", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([{ originIndex: 0, destinationIndex: 0, condition: "ROUTE_NOT_FOUND" }]), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await getDistance(noRouteOrigin, destination, "transit")).toBeNull();
    expect(await getDistance(noRouteOrigin, destination, "transit")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a Routes API error, so the next call retries", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getDistance(erroringOrigin, destination, "transit")).toBeNull();
    expect(await getDistance(erroringOrigin, destination, "transit")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

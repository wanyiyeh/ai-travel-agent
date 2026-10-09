import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { describeTransport, getDistance, getDistancesForStopPairs } from "./distanceMatrix";

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

// Story: in Japan every transit request came back ROUTE_NOT_FOUND, so every
// leg beyond walking distance showed 「搭計程車」 after paying for two requests.
describe("getDistancesForStopPairs in Japan", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("estimates a transit leg without calling Google, marked as an estimate", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const [leg] = await getDistancesForStopPairs(
      [
        { id: "tokyo-station", lat: 35.6812, lng: 139.7671 },
        { id: "shibuya", lat: 35.658, lng: 139.7016 },
      ],
      "transit"
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(leg).toMatchObject({ mode: "transit", estimated: true, durationSeconds: 25 * 60 });
    expect(describeTransport(leg!.mode, leg!.durationSeconds, leg!.estimated)).toBe("搭乘大眾運輸約 25 分鐘（估計）");
  });

  it("still asks Google outside Japan", async () => {
    const offset = (Date.now() % 100000) / 1e6;
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([{ originIndex: 0, destinationIndex: 0, condition: "ROUTE_EXISTS", distanceMeters: 9000, duration: "1988s" }]), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const [leg] = await getDistancesForStopPairs(
      [
        { id: "seoul-station", lat: 37.5547 + offset, lng: 126.9707 },
        { id: "gangnam", lat: 37.4979, lng: 127.0276 },
      ],
      "transit"
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(leg).toMatchObject({ mode: "transit", durationSeconds: 1988 });
    expect(leg).not.toHaveProperty("estimated");
    await prisma.distanceCache.deleteMany({ where: { cacheKey: { startsWith: `${(37.5547 + offset).toFixed(4)},` } } });
  });
});

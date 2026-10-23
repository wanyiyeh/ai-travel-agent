import { afterEach, describe, expect, it, vi } from "vitest";
import { describeTransport, getDistance, getDistancesForStopPairs } from "./distanceMatrix";
import { withRequestMemo } from "@/lib/requestMemo";

// Story: two stops in a small town have no transit coverage. A generation that
// schedules that leg more than once asks Routes once; a confirmed "no route"
// is shared within the request, an API error isn't, and nothing is kept after
// it (route results may not be cached, ADR-0004).
describe("getDistance shares a leg within one request, and keeps nothing after it", () => {
  // Route durations may not be cached (ADR-0004): a leg asked for twice in
  // one request is fetched once (requestMemo.ts), and the next request asks
  // Routes again.
  const offset = (Date.now() % 100000) / 1e6;
  const noRouteOrigin = { lat: 10 + offset, lng: 20 };
  const erroringOrigin = { lat: 11 + offset, lng: 20 };
  const destination = { lat: 12 + offset, lng: 20 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queries Routes once per request for a leg with no route", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify([{ originIndex: 0, destinationIndex: 0, condition: "ROUTE_NOT_FOUND" }]), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await withRequestMemo(async () => {
      expect(await getDistance(noRouteOrigin, destination, "transit")).toBeNull();
      expect(await getDistance(noRouteOrigin, destination, "transit")).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await withRequestMemo(() => getDistance(noRouteOrigin, destination, "transit"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not keep a Routes API error, even within the request, so the next call retries", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await withRequestMemo(async () => {
      expect(await getDistance(erroringOrigin, destination, "transit")).toBeNull();
      expect(await getDistance(erroringOrigin, destination, "transit")).toBeNull();
    });
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
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { mockGoogleResponse } from "@/lib/mockPlaces";
import { PLACE_UNAVAILABLE_NAME, fetchPlaceDisplays, hydrateDays } from "@/lib/placeDisplay";
import { stripDays } from "@/lib/placeStorage";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Google answered by the same fake MOCK_PLACES uses, recording each URL.
function fakeGoogle(fail: (url: string) => boolean = () => false) {
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      return fail(url) ? new Response("{}", { status: 429 }) : mockGoogleResponse(url, init);
    }),
  );
  return calls;
}

// A place as a Text Search would have found it, so its id carries its name.
function foundPlace(name: string) {
  const res = mockGoogleResponse("https://places.googleapis.com/v1/places:searchText", {
    body: JSON.stringify({ textQuery: name }),
  });
  return res.json() as Promise<{ places: { id: string; formattedAddress: string; location: { latitude: number; longitude: number } }[] }>;
}

async function trip() {
  const sensoji = (await foundPlace("淺草寺")).places[0];
  const skytree = (await foundPlace("東京晴空塔")).places[0];
  const days = [
    { day: 1, stops: [{ name: "淺草寺", placeId: sensoji.id, lat: 1, lng: 1 }, { name: "搭乘電車", description: "15 分鐘" }] },
    { day: 2, stops: [{ name: "東京晴空塔", placeId: skytree.id }, { name: "淺草寺", placeId: sensoji.id }] },
  ];
  return { stored: stripDays(days) as Record<string, unknown>[], sensoji, skytree };
}

describe("hydrateDays", () => {
  it("gives a stored itinerary its names and addresses back, for the chosen day only", async () => {
    const calls = fakeGoogle();
    const { stored, sensoji } = await trip();

    await hydrateDays(stored, [1]);

    const [day1, day2] = stored as { stops: Record<string, unknown>[] }[];
    expect(day1.stops[0]).toMatchObject({ name: "淺草寺", address: sensoji.formattedAddress, placeId: sensoji.id });
    expect(day1.stops[1]).toMatchObject({ name: "搭乘電車" }); // never had a place ID
    expect(day2.stops[0]).not.toHaveProperty("name");
    expect(calls).toHaveLength(1);
  });

  it("looks up a place on two days once", async () => {
    const calls = fakeGoogle();
    const { stored } = await trip();

    await hydrateDays(stored, "all");

    expect(calls).toHaveLength(2); // 淺草寺 and 晴空塔, not 淺草寺 twice
  });

  it("leaves an item that still has its name alone (storage before the switch)", async () => {
    const calls = fakeGoogle();
    await hydrateDays([{ day: 1, stops: [{ name: "淺草寺", placeId: "ChIJ-x" }] }], "all");
    expect(calls).toEqual([]);
  });

  it("still opens the page when Google can't answer", async () => {
    fakeGoogle(() => true);
    const { stored } = await trip();

    await expect(hydrateDays(stored, [1])).resolves.toBeDefined();
    expect((stored[0] as { stops: Record<string, unknown>[] }).stops[0]).toMatchObject({
      name: PLACE_UNAVAILABLE_NAME,
      displayUnavailable: true,
    });
  });
});

// Story: a trip saved two months ago lost its coordinates to the 30-day purge
// (ADR-0006); opening a day must put them back, fresh, in the same lookup.
describe("hydrateDays after the coordinates were purged", () => {
  it("brings the coordinates back with a new fetch time, without an extra request", async () => {
    const calls = fakeGoogle();
    const sensoji = (await foundPlace("淺草寺")).places[0];
    const days: Record<string, unknown>[] = [{ day: 1, stops: [{ placeId: sensoji.id, description: "寺廟。" }] }];
    const before = Date.now();

    await hydrateDays(days, [1]);

    const [stop] = (days[0] as { stops: Record<string, unknown>[] }).stops;
    expect(stop).toMatchObject({ name: "淺草寺", lat: sensoji.location.latitude, lng: sensoji.location.longitude });
    expect(Date.parse(stop.coordsFetchedAt as string)).toBeGreaterThanOrEqual(before);
    expect(calls).toHaveLength(1);
  });
});

describe("fetchPlaceDisplays", () => {
  it("asks only for the name and address (the Pro tier) and the location, which costs nothing more", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "test-key");
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => mockGoogleResponse(url, init));
    vi.stubGlobal("fetch", fetchSpy);

    await fetchPlaceDisplays(["mock-1"]);

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("X-Goog-FieldMask")).toBe("displayName,formattedAddress,location");
  });

  it("makes no request without an API key", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await fetchPlaceDisplays(["a", "b"])).toEqual(new Map([["a", null], ["b", null]]));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

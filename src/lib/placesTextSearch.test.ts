import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchPlaceEssentials, resolvePlace, searchPlaceText } from "./placesTextSearch";

const PLACE = {
  id: "p1",
  displayName: { text: "Café Savoy" },
  formattedAddress: "Prague",
  location: { latitude: 50.08, longitude: 14.41 },
};

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places: [PLACE] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchPlaceText in-flight dedupe", () => {
  it("merges concurrent identical requests into one Google call", async () => {
    const fetchMock = stubFetch();
    const bias = { lat: 50.07, lng: 14.43 };
    const [a, b] = await Promise.all([
      searchPlaceText("Café Savoy 布拉格", "key", bias),
      searchPlaceText("Café Savoy 布拉格", "key", bias),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a?.id).toBe("p1");
    expect(b?.id).toBe("p1");
  });

  it("does not merge requests that differ in bias or type", async () => {
    const fetchMock = stubFetch();
    await Promise.all([
      searchPlaceText("布拉格", "key", { lat: 50.07, lng: 14.43 }),
      searchPlaceText("布拉格", "key", null),
      searchPlaceText("布拉格", "key", null, "locality"),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("calls Google again once the earlier request has settled", async () => {
    const fetchMock = stubFetch();
    await searchPlaceText("Café Savoy 布拉格", "key");
    await searchPlaceText("Café Savoy 布拉格", "key");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("releases the slot after a failure so the next call retries", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchPlaceText("x", "key")).rejects.toThrow();
    await expect(searchPlaceText("x", "key")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// Any Enterprise-tier field in the mask bills the whole request as Enterprise
// (1,000 free/month vs Pro's 5,000) — this was ~98% of the 2026-09 bill.
describe("searchPlaceText field mask", () => {
  it("requests only Pro-tier fields", async () => {
    const fetchMock = stubFetch();
    await searchPlaceText("Field Mask Tier Check", "key");

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const mask = (init.headers as Record<string, string>)["X-Goog-FieldMask"].split(",");
    for (const enterpriseField of ["places.rating", "places.priceLevel", "places.userRatingCount"]) {
      expect(mask).not.toContain(enterpriseField);
    }
    expect(mask).toEqual(expect.arrayContaining(["places.id", "places.location", "places.photos"]));
  });
});

describe("resolvePlace", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Text Search answers with the place ID, Place Details with where it is.
  function google(details: Record<string, unknown> | null, searchPlaces: unknown[] = [{ id: "p1" }]) {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes(":searchText")
        ? new Response(JSON.stringify({ places: searchPlaces }), { status: 200 })
        : new Response(JSON.stringify(details ?? {}), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("finds a place with an ID-only search, then its location, types and address", async () => {
    google({ location: { latitude: 35.71, longitude: 139.79 }, types: ["tourist_attraction"], formattedAddress: "台東區" });

    expect(await resolvePlace("淺草寺 東京", "key", { lat: 35.68, lng: 139.77 })).toEqual({
      placeId: "p1",
      lat: 35.71,
      lng: 139.79,
      types: ["tourist_attraction"],
      address: "台東區",
    });
  });

  it("gives up without a details call when the search finds nothing", async () => {
    const fetchMock = google(null, []);
    expect(await resolvePlace("no such place", "key")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a same-named place a continent away from the city", async () => {
    google({ location: { latitude: -34.6, longitude: -58.38 } }); // Buenos Aires, for a Tokyo day
    expect(await resolvePlace("Cafe Tortoni 東京", "key", { lat: 35.68, lng: 139.77 })).toBeNull();
  });
});

describe("fetchPlaceEssentials", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks Place Details for Essentials-tier fields only", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ location: { latitude: 1, longitude: 2 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchPlaceEssentials("p1", "key");

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("X-Goog-FieldMask")).toBe("location,types,formattedAddress");
  });
});

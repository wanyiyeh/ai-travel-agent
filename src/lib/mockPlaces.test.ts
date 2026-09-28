import { afterEach, describe, expect, it, vi } from "vitest";
import { assertMockPlacesDatabase, mockGoogleResponse } from "./mockPlaces";
import { googleFetch } from "./googleFetch";
import { searchPlaceText } from "./placesTextSearch";
import { haversineKm } from "./geo";

const PRAGUE = { lat: 50.0755, lng: 14.4378 };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function post(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

describe("MOCK_PLACES", () => {
  it("googleFetch never touches the network in mock mode", async () => {
    vi.stubEnv("MOCK_PLACES", "1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const place = await searchPlaceText("Café Savoy 布拉格", "key", PRAGUE);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(place?.id).toMatch(/^mock-/);
  });

  it("googleFetch uses the real fetch when mock mode is off", async () => {
    vi.stubEnv("MOCK_PLACES", "");
    const fetchMock = vi.fn(async () => new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    await googleFetch("https://routes.googleapis.com/x", post({}));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Text Search results are deterministic and stay near the bias", async () => {
    const req = post({ textQuery: "Café Savoy 布拉格", locationBias: { circle: { center: { latitude: PRAGUE.lat, longitude: PRAGUE.lng } } } });
    const a = await mockGoogleResponse("https://places.googleapis.com/v1/places:searchText", req).json();
    const b = await mockGoogleResponse("https://places.googleapis.com/v1/places:searchText", req).json();
    expect(a).toEqual(b);
    const loc = a.places[0].location;
    expect(haversineKm(loc.latitude, loc.longitude, PRAGUE.lat, PRAGUE.lng)).toBeLessThanOrEqual(3.01);
  });

  it("an unbiased city lookup resolves to that city's known coordinates", async () => {
    const res = await mockGoogleResponse("https://places.googleapis.com/v1/places:searchText", post({ textQuery: "布拉格" }));
    const loc = (await res.json()).places[0].location;
    expect(loc.latitude).toBeCloseTo(PRAGUE.lat, 1);
    expect(loc.longitude).toBeCloseTo(PRAGUE.lng, 1);
  });

  it("a city missing from AIRPORTS still gets a stable (if unrealistic) point", async () => {
    const lookup = () =>
      mockGoogleResponse("https://places.googleapis.com/v1/places:searchText", post({ textQuery: "京都" })).json();
    expect((await lookup()).places[0].location).toEqual((await lookup()).places[0].location);
  });

  it("Nearby Search returns maxResultCount typed candidates inside the circle", async () => {
    const res = mockGoogleResponse(
      "https://places.googleapis.com/v1/places:searchNearby",
      post({
        includedTypes: ["museum"],
        maxResultCount: 5,
        locationRestriction: { circle: { center: { latitude: PRAGUE.lat, longitude: PRAGUE.lng }, radius: 20000 } },
      }),
    );
    const { places } = await res.json();
    expect(places).toHaveLength(5);
    expect(new Set(places.map((p: { id: string }) => p.id)).size).toBe(5);
    for (const p of places) {
      expect(p.types).toEqual(["museum"]);
      expect(haversineKm(p.location.latitude, p.location.longitude, PRAGUE.lat, PRAGUE.lng)).toBeLessThanOrEqual(3.01);
    }
  });

  it("route matrix returns a route whose duration scales with travel mode", async () => {
    const leg = (travelMode: string) =>
      mockGoogleResponse(
        "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
        post({
          origins: [{ waypoint: { location: { latLng: { latitude: 50.0755, longitude: 14.4378 } } } }],
          destinations: [{ waypoint: { location: { latLng: { latitude: 50.0865, longitude: 14.4114 } } } }],
          travelMode,
        }),
      ).json();
    const [walk] = await leg("WALK");
    const [drive] = await leg("DRIVE");
    expect(walk.condition).toBe("ROUTE_EXISTS");
    expect(parseInt(walk.duration, 10)).toBeGreaterThan(parseInt(drive.duration, 10));
  });

  it("refuses to run against a non-mock database", () => {
    vi.stubEnv("MOCK_PLACES", "1");
    vi.stubEnv("DATABASE_URL", "file:./dev.db");
    expect(() => assertMockPlacesDatabase()).toThrow(/mock/);
    vi.stubEnv("DATABASE_URL", "file:./mock.db");
    expect(() => assertMockPlacesDatabase()).not.toThrow();
  });
});

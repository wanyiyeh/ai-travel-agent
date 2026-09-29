import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TextSearchPlace } from "@/lib/placesTextSearch";

const CAIRO = { lat: 30.0444, lng: 31.2357 };
const SINAI = { lat: 29.5, lng: 34.0 };
const TAIPEI = { lat: 25.033, lng: 121.5654 };

const searchPlaceText = vi.fn();

vi.mock("@/lib/placesTextSearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/placesTextSearch")>();
  return {
    ...actual,
    searchPlaceText: (...args: unknown[]) => searchPlaceText(...args),
    getCityCenter: async (city: string) => ({ 開羅: CAIRO, 西奈半島: SINAI })[city] ?? null,
  };
});
// Every query is a cache miss, so each Text Search the route wants shows up
// as a searchPlaceText call.
vi.mock("@/lib/placeCache", () => ({
  lookupByQuery: async () => null,
  upsertPlace: async () => {},
}));

const { POST } = await import("./route");

function place(id: string, at: { lat: number; lng: number }): TextSearchPlace {
  return {
    id,
    displayName: { text: id },
    formattedAddress: "",
    location: { latitude: at.lat, longitude: at.lng },
  };
}

function search(query: string) {
  return POST(
    new Request("http://test/api", {
      method: "POST",
      body: JSON.stringify({ query, candidateCities: ["開羅", "西奈半島"] }),
    }),
  );
}

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  searchPlaceText.mockReset();
});

describe("places/search input limits", () => {
  it("rejects an oversized query without calling Google", async () => {
    const res = await POST(
      new Request("http://test/api", { method: "POST", body: JSON.stringify({ query: "a".repeat(201) }) }),
    );
    expect(res.status).toBe(400);
    expect(searchPlaceText).not.toHaveBeenCalled();
  });

  it("rejects more candidate cities than a trip can have days", async () => {
    const candidateCities = Array.from({ length: 31 }, (_, i) => `city${i}`);
    const res = await POST(
      new Request("http://test/api", { method: "POST", body: JSON.stringify({ query: "x", candidateCities }) }),
    );
    expect(res.status).toBe(400);
    expect(searchPlaceText).not.toHaveBeenCalled();
  });
});

describe("places/search attraction search", () => {
  it("uses the single unbiased match when it lands near a trip city", async () => {
    searchPlaceText.mockResolvedValue(place("sphinx", { lat: 29.9753, lng: 31.1376 }));

    const res = await search("獅身人面像");
    const body = await res.json();

    expect(searchPlaceText).toHaveBeenCalledTimes(1);
    expect(searchPlaceText.mock.calls[0][2]).toBeUndefined(); // no locationBias
    expect(body.place.id).toBe("sphinx");
    expect(body.nearestCity.city).toBe("開羅");
  });

  it("fans out per city when the unbiased match is a far-away homonym", async () => {
    searchPlaceText.mockImplementation(async (_q: string, _k: string, bias?: { lat: number; lng: number }) =>
      bias === undefined ? place("taipei-homonym", TAIPEI) : place(`near-${bias.lat}`, bias),
    );

    const res = await search("金字塔");
    const body = await res.json();

    // 1 unbiased + 1 per candidate city
    expect(searchPlaceText).toHaveBeenCalledTimes(3);
    expect(body.place.id).not.toBe("taipei-homonym");
  });

  it("falls back to the unbiased match without re-searching when nothing is near any city", async () => {
    searchPlaceText.mockImplementation(async (_q: string, _k: string, bias?: unknown) =>
      bias === undefined ? place("eiffel", { lat: 48.8584, lng: 2.2945 }) : null,
    );

    const res = await search("巴黎鐵塔");
    const body = await res.json();

    expect(searchPlaceText).toHaveBeenCalledTimes(3);
    // Too far from every trip city — the route rejects it outright.
    expect(body.place).toBeNull();
    expect(body.error).toMatch(/太遠/);
  });
});

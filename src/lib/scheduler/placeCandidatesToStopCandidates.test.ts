import { describe, expect, it } from "vitest";
import { placeCandidatesToStopCandidates, popularityScore } from "@/lib/scheduler/placeCandidatesToStopCandidates";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

function place(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  return {
    name: "Some Place",
    placeId: "place-1",
    lat: 35.0,
    lng: 139.0,
    address: "1 Some St",
    ...overrides,
  };
}

describe("placeCandidatesToStopCandidates", () => {
  it("returns an empty result for an empty place list", () => {
    const { candidates, candidateById } = placeCandidatesToStopCandidates([]);
    expect(candidates).toEqual([]);
    expect(candidateById.size).toBe(0);
  });

  it("uses the real placeId as the candidate id", () => {
    const { candidates, candidateById } = placeCandidatesToStopCandidates([
      place({ placeId: "ChIJ123", lat: 35.7, lng: 139.8 }),
    ]);
    expect(candidates[0].id).toBe("ChIJ123");
    expect(candidates[0].lat).toBe(35.7);
    expect(candidates[0].lng).toBe(139.8);
    expect(candidateById.get("ChIJ123")?.name).toBe("Some Place");
  });

  it("maps a place's real Google types to a duration category", () => {
    const { candidates } = placeCandidatesToStopCandidates([
      place({
        types: [
          "shinto_shrine", "tourist_attraction", "place_of_worship",
          "association_or_organization", "point_of_interest", "establishment",
        ],
      }),
    ]);
    expect(candidates[0].type).toBe("temple");
  });

  it("leaves type undefined when the place has no types at all", () => {
    const { candidates } = placeCandidatesToStopCandidates([place({ types: undefined })]);
    expect(candidates[0].type).toBeUndefined();
  });

  it("keeps a real rating when the place has one", () => {
    const { candidates } = placeCandidatesToStopCandidates([place({ rating: 4.2 })]);
    expect(candidates[0].rating).toBe(4.2);
  });

  it("scores unrated places by popularity rank, so Google's order survives later re-sorts", () => {
    const { candidates } = placeCandidatesToStopCandidates([
      place({ placeId: "most-popular" }),
      place({ placeId: "middle" }),
      place({ placeId: "least-popular" }),
    ]);
    expect(candidates.map((c) => c.rating)).toEqual([5, 4.25, 3.5]);
  });

  it("de-duplicates a placeId that appears more than once, keeping the first occurrence", () => {
    const { candidates, candidateById } = placeCandidatesToStopCandidates([
      place({ placeId: "dup", name: "First" }),
      place({ placeId: "dup", name: "Second" }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidateById.get("dup")?.name).toBe("First");
  });

  it("preserves input order and traces every candidate back to its place by id", () => {
    const places = [
      place({ placeId: "a", name: "A" }),
      place({ placeId: "b", name: "B" }),
    ];
    const { candidates, candidateById } = placeCandidatesToStopCandidates(places);
    expect(candidates.map((c) => candidateById.get(c.id)?.name)).toEqual(["A", "B"]);
  });
});

describe("popularityScore", () => {
  it("gives a single-place pool the top score", () => {
    expect(popularityScore(0, 1)).toBe(5);
  });
});

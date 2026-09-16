import { describe, expect, it } from "vitest";
import { placeCandidatesToStopCandidates } from "@/lib/scheduler/placeCandidatesToStopCandidates";
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

  it("defaults rating to null when absent, matching StopCandidate's contract", () => {
    const { candidates } = placeCandidatesToStopCandidates([place({ rating: undefined })]);
    expect(candidates[0].rating).toBeNull();
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

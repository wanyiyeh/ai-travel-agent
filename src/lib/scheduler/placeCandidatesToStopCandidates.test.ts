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
      place({ placeId: "most-popular", name: "A" }),
      place({ placeId: "middle", name: "B" }),
      place({ placeId: "least-popular", name: "C" }),
    ]);
    expect(candidates.map((c) => c.rating)).toEqual([5, 4.25, 3.5]);
  });

  it("treats two places with the same name as one, keeping the more popular", () => {
    const { candidates } = placeCandidatesToStopCandidates([
      place({ placeId: "park-1", name: "沖繩戰跡國定公園" }),
      place({ placeId: "park-2", name: "沖繩戰跡國定公園" }),
      place({ placeId: "other", name: "姬百合之塔" }),
    ]);
    expect(candidates.map((c) => c.id)).toEqual(["park-1", "other"]);
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

// Story: a budget Tokyo trip spent half of one day at 淺草寺 and half of the
// next at 淺草寺 雷門 — the same visit. Related places are grouped so the
// scheduler keeps them on one day, back to back.
describe("placeCandidatesToStopCandidates related places", () => {
  // Real coordinates from dev.db's cached pools.
  const sensoji = place({ placeId: "sensoji", name: "淺草寺", lat: 35.7147651, lng: 139.7966553 });
  const kaminarimon = place({ placeId: "kaminarimon", name: "淺草寺 雷門", lat: 35.7111, lng: 139.7963 });

  it("groups a place whose name starts with a nearby place's name under the first one", () => {
    const { candidates } = placeCandidatesToStopCandidates([sensoji, place({ placeId: "skytree", name: "東京晴空塔" }), kaminarimon]);
    expect(candidates.map((c) => c.groupId)).toEqual(["sensoji", undefined, "sensoji"]);
  });

  it("keeps both places — 倫敦塔橋 is not part of 倫敦塔, only next to it", () => {
    const { candidates } = placeCandidatesToStopCandidates([
      place({ placeId: "tower", name: "倫敦塔", lat: 51.5081, lng: -0.0759 }),
      place({ placeId: "bridge", name: "倫敦塔橋", lat: 51.5055, lng: -0.0754 }),
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates[1].groupId).toBe("tower");
  });

  it("leaves places with a shared name prefix apart when they're over 500m away", () => {
    const { candidates } = placeCandidatesToStopCandidates([
      place({ placeId: "arashiyama", name: "嵐山", lat: 35.0094, lng: 135.6668 }),
      place({ placeId: "bamboo", name: "嵐山竹林小徑", lat: 35.0170, lng: 135.6713 }),
    ]);
    expect(candidates.every((c) => c.groupId === undefined)).toBe(true);
  });
});

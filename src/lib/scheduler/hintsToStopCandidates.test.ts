import { describe, expect, it } from "vitest";
import { hintsToStopCandidates } from "@/lib/scheduler/hintsToStopCandidates";
import type { RestaurantHint } from "@/lib/fetchCityRestaurants";

describe("hintsToStopCandidates", () => {
  it("returns an empty result for an empty hint list", () => {
    const { candidates, hintById } = hintsToStopCandidates([]);
    expect(candidates).toEqual([]);
    expect(hintById.size).toBe(0);
  });

  it("drops hints missing lat/lng (e.g. stale CityPlaceHintsCache rows)", () => {
    const hints: RestaurantHint[] = [
      { name: "No coords yet", rating: 4.2 },
      { name: "Has coords", rating: 4.5, lat: 35.0, lng: 139.0 },
    ];
    const { candidates, hintById } = hintsToStopCandidates(hints);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].lat).toBe(35.0);
    expect(hintById.get(candidates[0].id)?.name).toBe("Has coords");
  });

  it("maps a hint's real Google types to a duration category", () => {
    const hints: RestaurantHint[] = [
      {
        name: "Sensō-ji",
        lat: 35.7148,
        lng: 139.7967,
        types: [
          "buddhist_temple", "tourist_attraction", "place_of_worship",
          "association_or_organization", "point_of_interest", "establishment",
        ],
      },
    ];
    const { candidates } = hintsToStopCandidates(hints);
    expect(candidates[0].type).toBe("temple");
  });

  it("leaves type undefined when the hint has no types at all", () => {
    const { candidates } = hintsToStopCandidates([{ name: "Untyped", lat: 1, lng: 2 }]);
    expect(candidates[0].type).toBeUndefined();
  });

  it("defaults rating to null when absent, matching StopCandidate's contract", () => {
    const { candidates } = hintsToStopCandidates([{ name: "No rating", lat: 1, lng: 2 }]);
    expect(candidates[0].rating).toBeNull();
  });

  it("traces every candidate back to its original hint by id, preserving relative order", () => {
    const hints: RestaurantHint[] = [
      { name: "A", lat: 1, lng: 1 },
      { name: "No coords", rating: 3 },
      { name: "B", lat: 2, lng: 2 },
    ];
    const { candidates, hintById } = hintsToStopCandidates(hints);
    expect(candidates.map((c) => hintById.get(c.id)?.name)).toEqual(["A", "B"]);
  });
});

import { describe, expect, it } from "vitest";
import { selectAndOrderStops, type StopCandidate } from "@/lib/scheduler/selectAndOrderStops";

// All on lat 0, spaced out along lng so nearest-neighbor ordering is
// unambiguous and easy to reason about by hand.
const A: StopCandidate = { id: "a", lat: 0, lng: 0, rating: 4.9, type: "museum" };
const B: StopCandidate = { id: "b", lat: 0, lng: 0.1, rating: 3.0, type: "park" };
const C: StopCandidate = { id: "c", lat: 0, lng: 0.2, rating: 4.5, type: "shopping" };
const D: StopCandidate = { id: "d", lat: 0, lng: 0.3, rating: 2.0, type: "temple" };

describe("selectAndOrderStops", () => {
  it("selects the top-N candidates by rating when no interest weights are given", () => {
    const result = selectAndOrderStops([A, B, C, D], { count: 2 });
    expect(result.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("lets an interest weight override raw rating in selection", () => {
    const result = selectAndOrderStops([A, B, C, D], {
      count: 1,
      interestWeights: { park: 10 },
    });
    expect(result[0].id).toBe("b");
  });

  it("orders selected candidates by nearest-neighbor from the given origin", () => {
    const result = selectAndOrderStops([A, B, C, D], {
      count: 3, // selects a, c, b by rating
      origin: { lat: 0, lng: 0.35 }, // closest to c, then b, then a
    });
    expect(result.map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("starts from the highest-scored candidate when no origin is given", () => {
    const result = selectAndOrderStops([A, B, C, D], { count: 2 });
    expect(result[0].id).toBe("a");
  });

  it("treats an unrated candidate as a neutral rating rather than zero", () => {
    const unrated: StopCandidate = { id: "unrated", lat: 0, lng: 0.05 };
    const lowRated: StopCandidate = { id: "low", lat: 0, lng: 0.05, rating: 2.0 };
    const result = selectAndOrderStops([unrated, lowRated], { count: 1 });
    expect(result[0].id).toBe("unrated");
  });

  it("returns all candidates ordered when count exceeds the pool size", () => {
    const result = selectAndOrderStops([A, B], { count: 10 });
    expect(result).toHaveLength(2);
  });

  it("returns an empty array for a non-positive count", () => {
    expect(selectAndOrderStops([A, B], { count: 0 })).toEqual([]);
  });

  it("returns an empty array for an empty candidate pool", () => {
    expect(selectAndOrderStops([], { count: 3 })).toEqual([]);
  });
});

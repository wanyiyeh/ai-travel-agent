import { describe, expect, it } from "vitest";
import { distanceFactor, scoreCandidate, selectAndOrderStops, type StopCandidate } from "@/lib/scheduler/selectAndOrderStops";

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

// ~0.027° of latitude ≈ 3km, the distance at which the score halves.
const hotel = { lat: 35, lng: 135 };
const kmNorth = (km: number) => ({ lat: 35 + km / 111.2, lng: 135 });

describe("distanceFactor", () => {
  it("is 1 at the lodging, 1/2 at 3km and 1/4 at 9km", () => {
    expect(distanceFactor({ id: "a", ...hotel }, hotel)).toBe(1);
    expect(distanceFactor({ id: "a", ...kmNorth(3) }, hotel)).toBeCloseTo(0.5, 2);
    expect(distanceFactor({ id: "a", ...kmNorth(9) }, hotel)).toBeCloseTo(0.25, 2);
  });
});

describe("scoreCandidate — rating × preference × distance", () => {
  it("multiplies all three when an anchor is given", () => {
    const museum: StopCandidate = { id: "m", ...kmNorth(3), rating: 4, type: "museum" };
    expect(scoreCandidate(museum, { museum: 1.5 }, hotel)).toBeCloseTo(4 * 1.5 * 0.5, 2);
  });

  it("ignores distance without an anchor", () => {
    const museum: StopCandidate = { id: "m", ...kmNorth(30), rating: 4, type: "museum" };
    expect(scoreCandidate(museum, {})).toBe(4);
  });
});

describe("selectAndOrderStops with a lodging anchor", () => {
  const far: StopCandidate = { id: "famous-far", ...kmNorth(10), rating: 5 };
  const near: StopCandidate = { id: "plain-near", ...kmNorth(1), rating: 4 };

  it("picks a nearby ordinary place over a far famous one", () => {
    // far: 5 × 0.23 = 1.15, near: 4 × 0.75 = 3.0
    expect(selectAndOrderStops([far, near], { count: 1, anchor: hotel }).map((c) => c.id)).toEqual(["plain-near"]);
  });

  it("still picks the higher-rated place when no anchor is given", () => {
    expect(selectAndOrderStops([far, near], { count: 1 }).map((c) => c.id)).toEqual(["famous-far"]);
  });
});

describe("selectAndOrderStops with related places", () => {
  it("visits the rest of a group right after its first place, even when another stop is nearer", () => {
    // From the origin, nearest-neighbor alone would go temple -> cafe -> gate.
    const temple: StopCandidate = { id: "temple", lat: 0, lng: 0, groupId: "temple" };
    const cafe: StopCandidate = { id: "cafe", lat: 0, lng: 0.002 };
    const gate: StopCandidate = { id: "gate", lat: 0, lng: -0.003, groupId: "temple" };
    const result = selectAndOrderStops([temple, cafe, gate], { count: 3, origin: { lat: 0, lng: 0 } });
    expect(result.map((c) => c.id)).toEqual(["temple", "gate", "cafe"]);
  });
});

import { describe, expect, it } from "vitest";
import { partitionCandidatesByDay } from "@/lib/scheduler/partitionCandidatesByDay";
import type { StopCandidate } from "@/lib/scheduler/selectAndOrderStops";

function candidate(id: string, lat: number, lng: number, rating?: number): StopCandidate {
  return { id, lat, lng, rating: rating ?? null };
}

describe("partitionCandidatesByDay", () => {
  it("returns one empty group per day for an empty pool", () => {
    expect(partitionCandidatesByDay([], [2, 2])).toEqual([[], []]);
  });

  it("returns an empty group for a day that needs zero candidates, without consuming any", () => {
    const pool = [candidate("a", 0, 0), candidate("b", 0, 0)];
    const days = partitionCandidatesByDay(pool, [0, 2]);
    expect(days[0]).toEqual([]);
    expect(days[1]).toHaveLength(2);
  });

  it("never assigns the same candidate to two different days", () => {
    const pool = Array.from({ length: 9 }, (_, i) => candidate(`c${i}`, i, i, 4 + (i % 2) * 0.1));
    const days = partitionCandidatesByDay(pool, [3, 3, 3]);
    const allIds = days.flat().map((c) => c.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds).toHaveLength(9);
  });

  it("seeds each day with the highest-scoring remaining candidate, spreading quality across days", () => {
    const pool = [
      candidate("best", 0, 0, 4.9),
      candidate("second-best", 10, 10, 4.7),
      candidate("filler-1", 0.01, 0.01, 3.0),
      candidate("filler-2", 10.01, 10.01, 3.0),
    ];
    const days = partitionCandidatesByDay(pool, [2, 2]);
    // "best" and "second-best" should each seed their own day rather than
    // both landing in day 1 just because they're both high-scored overall.
    expect(days[0][0].id).toBe("best");
    expect(days[1][0].id).toBe("second-best");
  });

  it("fills the rest of a day with the geographically nearest remaining candidates to its seed", () => {
    const pool = [
      candidate("seed", 0, 0, 5),
      candidate("near", 0.01, 0.01, 3),
      candidate("far", 20, 20, 3),
    ];
    const days = partitionCandidatesByDay(pool, [2]);
    expect(days[0].map((c) => c.id)).toEqual(["seed", "near"]);
  });

  it("gives later days fewer candidates than requested once the pool runs out, instead of reusing one", () => {
    const pool = [candidate("a", 0, 0), candidate("b", 0, 0)];
    const days = partitionCandidatesByDay(pool, [2, 2]);
    expect(days[0]).toHaveLength(2);
    expect(days[1]).toHaveLength(0);
  });

  it("applies interestWeights when picking each day's seed", () => {
    const pool = [
      candidate("higher-rating", 0, 0, 4.5),
      candidate("boosted-type", 5, 5, 4.0),
    ];
    pool[1].type = "temple";
    const days = partitionCandidatesByDay(pool, [1, 1], { temple: 2 });
    expect(days[0][0].id).toBe("boosted-type");
  });
});

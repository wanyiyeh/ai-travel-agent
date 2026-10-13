import { describe, expect, it } from "vitest";
import {
  distributeStopsPerDay,
  fillShortDays,
  partitionCandidatesByDay,
  partitionCandidatesWithSeeds,
} from "@/lib/scheduler/partitionCandidatesByDay";
import type { StopCandidate } from "@/lib/scheduler/selectAndOrderStops";

function candidate(id: string, lat: number, lng: number, rating?: number): StopCandidate {
  return { id, lat, lng, rating: rating ?? null };
}

describe("partitionCandidatesByDay", () => {
  it("keeps a reserved candidate for its own day, even when it scores best", () => {
    // a seasonal highlight (seasonalHighlights.ts) belongs to the seasonal day
    const pool = [candidate("highlight", 0, 0, 4.9), candidate("a", 0, 0, 4.0), candidate("b", 0, 0, 4.0), candidate("c", 0, 0, 4.0)];
    const days = partitionCandidatesByDay(pool, [2, 2], {}, undefined, {
      reservedDay: (c) => (c.id === "highlight" ? 1 : undefined),
    });
    expect(days[0].map((c) => c.id)).not.toContain("highlight");
    expect(days[1].map((c) => c.id)).toContain("highlight");
  });

  it("leaves a day short rather than give it another day's reserved candidate", () => {
    const pool = [candidate("highlight", 0, 0), candidate("a", 0, 0)];
    const days = partitionCandidatesByDay(pool, [2, 0], {}, undefined, { reservedDay: (c) => (c.id === "highlight" ? 1 : undefined) });
    expect(days[0].map((c) => c.id)).toEqual(["a"]);
  });

  it("keeps a day in one area with a smaller spread, even past a better-rated place further off", () => {
    // 長輩: the second stop stays near the first rather than crossing town
    const seed = candidate("seed", 0, 0, 4.9);
    const nearby = candidate("nearby", 0, 0.0135, 4.0); // ~1.5km
    const across = candidate("across", 0, 0.02, 4.85); // ~2.2km, better rated than nearby
    const usual = partitionCandidatesByDay([seed, nearby, across], [2]);
    const compact = partitionCandidatesByDay([seed, nearby, across], [2], {}, undefined, { spreadKm: 1 });
    expect(usual[0].map((c) => c.id)).toEqual(["seed", "across"]);
    expect(compact[0].map((c) => c.id)).toEqual(["seed", "nearby"]);
  });

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

describe("partitionCandidatesByDay with a lodging anchor", () => {
  it("seeds the first day with the best place near the lodging, not the best overall", () => {
    const pool = [candidate("famous-far", 0.2, 0, 5), candidate("good-near", 0.005, 0, 4.2), candidate("other", 0.1, 0, 3)];
    const [day1] = partitionCandidatesByDay(pool, [1], {}, { lat: 0, lng: 0 });
    expect(day1.map((c) => c.id)).toEqual(["good-near"]);
  });
});

// Story: staying in Shinjuku, 文化歷史, 自然景觀 and no preference all got
// the same 8 places — each day was filled with the places nearest its first
// stop, whatever their type.
describe("partitionCandidatesByDay with interest weights", () => {
  it("fills a day with a preferred place over a slightly nearer one", () => {
    const seed = { ...candidate("seed", 0, 0, 5), type: "museum" };
    const nearPark = { ...candidate("park", 0, 0.01, 4), type: "park" };
    const temple = { ...candidate("temple", 0, 0.02, 4), type: "temple" };
    const [none] = partitionCandidatesByDay([seed, nearPark, temple], [2]);
    const [culture] = partitionCandidatesByDay([seed, nearPark, temple], [2], { museum: 1.5, temple: 1.5 });
    expect(none.map((c) => c.id)).toEqual(["seed", "park"]);
    expect(culture.map((c) => c.id)).toEqual(["seed", "temple"]);
  });
});

describe("partitionCandidatesByDay with related places", () => {
  it("puts a whole group on one day even when its second place is far down the ranking", () => {
    const sensoji = { ...candidate("sensoji", 0, 0, 5), groupId: "sensoji" };
    const gate = { ...candidate("gate", 0, 0.004, 3), groupId: "sensoji" };
    const near = candidate("near", 0, 0.001, 4);
    const far = candidate("far", 0, 1, 4.5);
    const days = partitionCandidatesByDay([sensoji, near, far, gate], [2, 2]);
    expect(days[0].map((c) => c.id)).toEqual(["sensoji", "gate"]);
    expect(days[1].map((c) => c.id).sort()).toEqual(["far", "near"]);
  });

  it("skips a nearby group that doesn't fit the day's remaining room", () => {
    const seed = candidate("seed", 0, 0, 5);
    const pair = [
      { ...candidate("p1", 0, 0.001, 3), groupId: "p" },
      { ...candidate("p2", 0, 0.002, 3), groupId: "p" },
    ];
    const single = candidate("single", 0, 0.01, 3);
    const [day] = partitionCandidatesByDay([seed, ...pair, single], [2]);
    expect(day.map((c) => c.id)).toEqual(["seed", "single"]);
  });
});

describe("partitionCandidatesByDay with day themes", () => {
  // Same spot, so distance never decides; ratings decide among equals.
  const theme = (id: string, rating: number) => ({ ...candidate(id, 0, 0, rating), type: "museum" });
  const popular = (id: string, rating: number) => ({ ...candidate(id, 0, 0, rating), type: "park" });
  const onTheme = (c: StopCandidate) => c.type === "museum";
  const popularIds = new Set(["p1", "p2"]);
  const isPopular = (c: StopCandidate) => popularIds.has(c.id);

  it("fills a themed day with on-theme places and keeps the rest for popular sights", () => {
    const pool = [popular("p1", 5), popular("p2", 4.9), theme("t1", 4), theme("t2", 3.9), theme("t3", 3.8)];
    const [day] = partitionCandidatesByDay(pool, [3], {}, undefined, {
      themes: [{ onTheme, themeCount: 2 }],
      isPopular,
    });
    expect(day.map((c) => c.id)).toEqual(["t1", "t2", "p1"]);
  });

  it("fills the day with whatever's left when the theme pool runs out", () => {
    const pool = [popular("p1", 5), popular("p2", 4.9), theme("t1", 4), candidate("other", 0, 0, 3)];
    const [day] = partitionCandidatesByDay(pool, [4], {}, undefined, {
      themes: [{ onTheme, themeCount: 3 }],
      isPopular,
    });
    expect(day.map((c) => c.id)).toEqual(["t1", "p1", "p2", "other"]);
  });

  it("leaves a day without a theme as before", () => {
    const pool = [popular("p1", 5), theme("t1", 4)];
    const [day] = partitionCandidatesByDay(pool, [1], {}, undefined, { themes: [undefined], isPopular });
    expect(day.map((c) => c.id)).toEqual(["p1"]);
  });
});

describe("distributeStopsPerDay", () => {
  it("gives every day its cap when the pool is big enough", () => {
    expect(distributeStopsPerDay(20, [4, 4, 4])).toEqual([4, 4, 4]);
  });

  it("spreads a 20-place pool over 9 days instead of leaving the last days empty", () => {
    expect(distributeStopsPerDay(20, Array(9).fill(4))).toEqual([3, 3, 2, 2, 2, 2, 2, 2, 2]);
  });

  it("respects a smaller cap on one day and gives the spare stops to the others", () => {
    // e.g. an arrival day with time for only one stop
    expect(distributeStopsPerDay(7, [1, 3, 3])).toEqual([1, 3, 3]);
    expect(distributeStopsPerDay(5, [1, 3, 3])).toEqual([1, 2, 2]);
  });

  it("gives nothing to a day with zero capacity", () => {
    expect(distributeStopsPerDay(6, [0, 3])).toEqual([0, 3]);
  });

  it("returns no days for a zero-day block", () => {
    expect(distributeStopsPerDay(20, [])).toEqual([]);
  });
});

// Staying in 新宿, a 文化巡禮 day kept to small galleries nearby and never reached 上野.
describe("partitionCandidatesByDay — where a themed day goes", () => {
  const shinjuku = { lat: 35.6896, lng: 139.7006 };
  const gallery = candidate("gallery", 35.692, 139.703, 4.6); // in 新宿, a less known one
  const museum = candidate("tokyo-national-museum", 35.7188, 139.7765, 4.5); // 上野, about 8km
  const nearUeno = candidate("ueno-zoo", 35.7164, 139.7714, 4.3);
  const culture = (ids: string[]) => ({ onTheme: (c: StopCandidate) => ids.includes(c.id), themeCount: 2 });
  const rank = new Map([["tokyo-national-museum", 0], ["gallery", 6]]);

  it("starts from its theme's most popular place, however far from the lodging", () => {
    const [day] = partitionCandidatesByDay([gallery, museum, nearUeno], [2], {}, shinjuku, {
      themes: [culture(["gallery", "tokyo-national-museum"])],
      popularityRank: (c) => rank.get(c.id),
    });
    expect(day[0].id).toBe("tokyo-national-museum");
  });

  it("keeps the ranked ones first when others have no rank", () => {
    // Two unranked places once turned the sort to NaN and put one of them first.
    const tower = candidate("tokyo-tower", 35.6586, 139.7454, 4.5);
    const sky = candidate("shibuya-sky", 35.6585, 139.7023, 4.7);
    const [day] = partitionCandidatesByDay([tower, sky, museum, gallery], [2], {}, shinjuku, {
      themes: [culture(["tokyo-tower", "shibuya-sky", "gallery", "tokyo-national-museum"])],
      popularityRank: (c) => rank.get(c.id),
    });
    expect(day[0].id).toBe("tokyo-national-museum");
  });

  it("starts from the nearest one without a popularity ranking, as before", () => {
    const [day] = partitionCandidatesByDay([gallery, museum, nearUeno], [2], {}, shinjuku, {
      themes: [culture(["gallery", "tokyo-national-museum"])],
    });
    expect(day[0].id).toBe("gallery");
  });
});


describe("partitionCandidatesByDay maxFillKm", () => {
  // 0.009° of longitude at the equator is ~1km
  const seed = candidate("seed", 0, 0, 4.9);
  const near = candidate("near", 0, 0.018, 4.0); // ~2km
  const far = candidate("far", 0, 0.072, 4.8); // ~8km, better rated than near

  it("leaves a day short rather than take a place past the limit", () => {
    // 台場's day took its third place from 渋谷, 8km away
    const [day] = partitionCandidatesByDay([seed, near, far], [3], {}, undefined, { maxFillKm: 4 });
    expect(day.map((c) => c.id)).toEqual(["seed", "near"]);
  });

  it("takes any place without a limit, as before", () => {
    const [day] = partitionCandidatesByDay([seed, near, far], [3]);
    expect(day.map((c) => c.id)).toContain("far");
  });

  it("still puts a reserved candidate on its day, however far", () => {
    const [day] = partitionCandidatesByDay([seed, near, far], [3], {}, undefined, {
      maxFillKm: 4,
      reservedDay: (c) => (c.id === "far" ? 0 : undefined),
    });
    expect(day.map((c) => c.id)).toContain("far");
  });
});

describe("partitionCandidatesWithSeeds", () => {
  it("returns each day's seed, and none for a day that got nothing", () => {
    const pool = [candidate("a", 0, 0, 4.9), candidate("b", 0, 0.001, 4.0)];
    const { days, seeds } = partitionCandidatesWithSeeds(pool, [2, 2]);
    expect(seeds[0]?.id).toBe("a");
    expect(days[1]).toEqual([]);
    expect(seeds[1]).toBeUndefined();
  });
});

describe("fillShortDays", () => {
  const seedA = candidate("seedA", 0, 0, 4.5);
  const seedB = candidate("seedB", 0, 0.09, 4.5); // ~10km from seedA

  it("tops up a short day from places near its own seed", () => {
    const nearA = candidate("nearA", 0, 0.009, 4.0);
    const nearB = candidate("nearB", 0, 0.099, 4.0);
    const days = fillShortDays([[seedA], [seedB]], [seedA, seedB], [2, 2], [nearB, nearA], {}, { maxFillKm: 4 });
    expect(days.map((d) => d.map((c) => c.id))).toEqual([
      ["seedA", "nearA"],
      ["seedB", "nearB"],
    ]);
  });

  it("uses each extra place once, for the earlier day first", () => {
    const between = candidate("between", 0, 0.045, 4.0); // ~5km from both
    const days = fillShortDays([[seedA], [seedB]], [seedA, seedB], [2, 2], [between], {});
    expect(days[0].map((c) => c.id)).toEqual(["seedA", "between"]);
    expect(days[1].map((c) => c.id)).toEqual(["seedB"]);
  });

  it("stays short rather than take an extra past the limit", () => {
    const far = candidate("far", 0, 0.072, 4.0); // ~8km
    const [day] = fillShortDays([[seedA]], [seedA], [3], [far], {}, { maxFillKm: 4 });
    expect(day.map((c) => c.id)).toEqual(["seedA"]);
  });

  it("leaves a full day and a day without a seed as they were", () => {
    const extra = candidate("extra", 0, 0.001, 4.0);
    const days = fillShortDays([[seedA, candidate("x", 0, 0, 4)], []], [seedA, undefined], [2, 2], [extra], {});
    expect(days[0].map((c) => c.id)).toEqual(["seedA", "x"]);
    expect(days[1]).toEqual([]);
  });

  it("takes the parts of one sight together, or not at all", () => {
    const temple: StopCandidate = { ...candidate("temple", 0, 0.001, 4.8), groupId: "temple" };
    const gate: StopCandidate = { ...candidate("gate", 0, 0.002, 4.0), groupId: "temple" };
    const single = candidate("single", 0, 0.003, 3.5);
    const roomForTwo = fillShortDays([[seedA]], [seedA], [3], [temple, gate, single], {});
    expect(roomForTwo[0].map((c) => c.id).sort()).toEqual(["gate", "seedA", "temple"]);
    const roomForOne = fillShortDays([[seedA]], [seedA], [2], [temple, gate, single], {});
    expect(roomForOne[0].map((c) => c.id)).toEqual(["seedA", "single"]);
  });
});

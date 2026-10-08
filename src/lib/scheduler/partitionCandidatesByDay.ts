import { scoreCandidate, type StopCandidate } from "@/lib/scheduler/selectAndOrderStops";

/**
 * Per-day stop counts for partitionCandidatesByDay when the pool is too small
 * to give every day its full capacity. Nearby Search returns at most 20
 * places, so filling days in order let days 1-5 of a 9-day city block take
 * all 20 and left days 6-9 empty (validateItinerary's DAY_TOO_FEW_STOPS,
 * plan/hybrid-rule-engine-scheduling.md 0.10). Deals the pool out one stop
 * per day in turn instead, skipping days already at their own cap
 * (`maxPerDay[i]` — the trip's arrival day has less time than the rest).
 */
export function distributeStopsPerDay(poolSize: number, maxPerDay: number[]): number[] {
  const counts = maxPerDay.map(() => 0);
  let remaining = poolSize;
  let dealt = true;
  while (remaining > 0 && dealt) {
    dealt = false;
    for (let i = 0; i < counts.length && remaining > 0; i++) {
      if (counts[i] < maxPerDay[i]) {
        counts[i]++;
        remaining--;
        dealt = true;
      }
    }
  }
  return counts;
}

export type DayThemeSlots = {
  onTheme: (c: StopCandidate) => boolean;
  /** How many of the day's stops should be on theme. */
  themeCount: number;
};

export type PartitionOptions = {
  /** Per day; undefined for a day without a theme. */
  themes?: (DayThemeSlots | undefined)[];
  /** The popular-sight pool, for a themed day's remaining stops. */
  isPopular?: (c: StopCandidate) => boolean;
};

/**
 * Splits one shared candidate pool into disjoint per-day groups — the gap
 * found while scoping how to wire buildDaySkeleton into a real multi-day
 * city block (plan/hybrid-rule-engine-scheduling.md Phase 3): every existing
 * scheduler module operates on one day's candidate pool at a time, but a
 * city staying N days needs N non-overlapping selections from one pool so
 * the same place never gets scheduled twice.
 *
 * `perDayCounts[i]` is how many candidates day i needs (its own
 * buildDaySkeleton `count`) — lengths need not be equal across days. Each
 * day's group is picked in two steps: the single highest-scoring remaining
 * candidate becomes that day's "seed" (spreads the best-reviewed places
 * across days instead of one day claiming them all), then the group fills
 * out with the `count - 1` best candidates scored from the seed — rating ×
 * interest × distance from the seed (keeps each day's stops in one area
 * rather than scattered across the city, while still favoring the
 * traveler's interests — selectAndOrderStops/buildDaySkeleton still does the actual
 * within-day route ordering afterward, this only decides which candidates
 * belong to which day). If the pool runs out, later days simply get fewer
 * candidates than requested rather than reusing an already-assigned one.
 * Candidates sharing a `groupId` always land on the same day.
 *
 * With `options.themes`, a themed day seeds from an on-theme place, fills
 * `themeCount` stops (seed included) from on-theme places, and the rest from
 * `isPopular` ones — each step falling back to anything left when its kind
 * runs out, so a day is never short just because the theme pool is.
 */
export function partitionCandidatesByDay(
  candidates: StopCandidate[],
  perDayCounts: number[],
  interestWeights: Record<string, number> = {},
  anchor?: { lat: number; lng: number },
  options: PartitionOptions = {}
): StopCandidate[][] {
  const remaining = [...candidates];
  const days: StopCandidate[][] = [];
  const groupOf = (c: StopCandidate) => (c.groupId ? remaining.filter((r) => r.groupId === c.groupId) : [c]);
  const take = (group: StopCandidate[]) => {
    for (const c of group) remaining.splice(remaining.indexOf(c), 1);
    return group;
  };

  perDayCounts.forEach((count, dayIdx) => {
    if (count <= 0 || remaining.length === 0) {
      days.push([]);
      return;
    }
    const theme = options.themes?.[dayIdx];

    remaining.sort((a, b) => scoreCandidate(b, interestWeights, anchor) - scoreCandidate(a, interestWeights, anchor));
    // A group (parts of one sight) is taken whole. The seed is the best place
    // whose group fits; one that fits nowhere still goes in whole, not split.
    const fits = (c: StopCandidate) => groupOf(c).length <= count;
    const seed =
      (theme && remaining.find((c) => theme.onTheme(c) && fits(c))) ?? remaining.find(fits) ?? remaining[0];
    const day = take(groupOf(seed));

    // The same score as the seed's, but measured from the seed instead of the
    // lodging, so the day stays in one area. Picking by distance alone undid the
    // interest weights: staying in Shinjuku, the 8 places nearest each seed were
    // the same for 文化歷史, 自然景觀 and no preference at all.
    remaining.sort((a, b) => scoreCandidate(b, interestWeights, seed) - scoreCandidate(a, interestWeights, seed));
    const fill = (limit: number, wanted: (c: StopCandidate) => boolean) => {
      for (const candidate of [...remaining]) {
        if (day.length >= limit) break;
        if (!remaining.includes(candidate) || !wanted(candidate)) continue; // taken with its group, or not wanted
        const group = groupOf(candidate);
        if (day.length + group.length <= limit) day.push(...take(group));
      }
    };
    if (theme) {
      fill(theme.themeCount, theme.onTheme);
      if (options.isPopular) fill(count, options.isPopular);
    }
    fill(count, () => true);

    days.push(day);
  });

  return days;
}

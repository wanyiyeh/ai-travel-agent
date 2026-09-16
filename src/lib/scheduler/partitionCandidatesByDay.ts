import { haversineKm } from "@/lib/distanceMatrix";
import { scoreCandidate, type StopCandidate } from "@/lib/scheduler/selectAndOrderStops";

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
 * out with the `count - 1` candidates geographically nearest to the seed
 * (keeps each day's stops in one area rather than scattered across the
 * city — selectAndOrderStops/buildDaySkeleton still does the actual
 * within-day route ordering afterward, this only decides which candidates
 * belong to which day). If the pool runs out, later days simply get fewer
 * candidates than requested rather than reusing an already-assigned one.
 */
export function partitionCandidatesByDay(
  candidates: StopCandidate[],
  perDayCounts: number[],
  interestWeights: Record<string, number> = {}
): StopCandidate[][] {
  const remaining = [...candidates];
  const days: StopCandidate[][] = [];

  for (const count of perDayCounts) {
    if (count <= 0 || remaining.length === 0) {
      days.push([]);
      continue;
    }

    remaining.sort((a, b) => scoreCandidate(b, interestWeights) - scoreCandidate(a, interestWeights));
    const seed = remaining.shift()!;

    remaining.sort(
      (a, b) => haversineKm(seed.lat, seed.lng, a.lat, a.lng) - haversineKm(seed.lat, seed.lng, b.lat, b.lng)
    );
    const nearest = remaining.splice(0, count - 1);

    days.push([seed, ...nearest]);
  }

  return days;
}

import { haversineKm } from "@/lib/distanceMatrix";

export type StopCandidate = {
  id: string;
  lat: number;
  lng: number;
  type?: string;
  rating?: number | null;
};

export type SelectAndOrderStopsOptions = {
  /** How many candidates to pick for the day. */
  count: number;
  /** Starting point for nearest-neighbor ordering, e.g. the day's accommodation. Defaults to the highest-scored selected candidate. */
  origin?: { lat: number; lng: number };
  /** Multiplier applied to a candidate's score by its `type`, e.g. from PreferenceIntent.interestBoost. Unlisted types default to 1. */
  interestWeights?: Record<string, number>;
};

// Neutral score for a candidate with no rating, so an unrated place isn't
// penalized to zero against rated ones.
const DEFAULT_RATING = 3.5;

function scoreCandidate(
  candidate: StopCandidate,
  interestWeights: Record<string, number>
): number {
  const baseRating = candidate.rating ?? DEFAULT_RATING;
  const weight = candidate.type ? (interestWeights[candidate.type] ?? 1) : 1;
  return baseRating * weight;
}

function nearestNeighborOrder(
  candidates: StopCandidate[],
  origin: { lat: number; lng: number }
): StopCandidate[] {
  const remaining = [...candidates];
  const ordered: StopCandidate[] = [];
  let current = origin;

  while (remaining.length > 0) {
    let nearestIndex = 0;
    let nearestDistanceKm = Infinity;
    remaining.forEach((candidate, index) => {
      const distanceKm = haversineKm(current.lat, current.lng, candidate.lat, candidate.lng);
      if (distanceKm < nearestDistanceKm) {
        nearestDistanceKm = distanceKm;
        nearestIndex = index;
      }
    });
    const [next] = remaining.splice(nearestIndex, 1);
    ordered.push(next);
    current = next;
  }

  return ordered;
}

/**
 * Picks `count` candidates from a Places candidate pool and orders them into
 * a walkable route, per plan/hybrid-rule-engine-scheduling.md section 3.2.
 *
 * Selection is a weighted-rating sort: each candidate scores `rating *
 * interestWeights[type]` (unrated defaults to a neutral rating, unweighted
 * types default to weight 1), and the top `count` are kept. Ordering is
 * greedy nearest-neighbor from `origin` (or the highest-scored candidate
 * when no origin is given) — a "don't backtrack too much" heuristic, not a
 * true shortest-route solver (deliberately deferred per the plan's risk
 * notes on avoiding over-engineering the first version).
 */
export function selectAndOrderStops(
  candidates: StopCandidate[],
  options: SelectAndOrderStopsOptions
): StopCandidate[] {
  const { count, origin, interestWeights = {} } = options;
  if (count <= 0 || candidates.length === 0) return [];

  const selected = [...candidates]
    .sort((a, b) => scoreCandidate(b, interestWeights) - scoreCandidate(a, interestWeights))
    .slice(0, count);

  const startPoint = origin ?? selected[0];
  return nearestNeighborOrder(selected, startPoint);
}

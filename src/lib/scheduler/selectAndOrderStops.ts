import { haversineKm } from "@/lib/distanceMatrix";

export type StopCandidate = {
  id: string;
  lat: number;
  lng: number;
  type?: string;
  rating?: number | null;
  /** Shared by parts of one sight listed separately (淺草寺 and 淺草寺 雷門) — scheduled on the same day, back to back. */
  groupId?: string;
  /** Multiplies the score, e.g. an accessible entrance on a 長輩 trip. */
  boost?: number;
};

export type SelectAndOrderStopsOptions = {
  /** How many candidates to pick for the day. */
  count: number;
  /** Starting point for nearest-neighbor ordering, e.g. the day's accommodation. Defaults to the highest-scored selected candidate. */
  origin?: { lat: number; lng: number };
  /** Multiplier applied to a candidate's score by its `type`, e.g. from PreferenceIntent.interestBoost. Unlisted types default to 1. */
  interestWeights?: Record<string, number>;
  /** Where the traveler is staying — nearer candidates score higher (see distanceFactor). */
  anchor?: { lat: number; lng: number };
};

// Neutral score for a candidate with no rating, so an unrated place isn't
// penalized to zero against rated ones.
const DEFAULT_RATING = 3.5;

// Distance at which a candidate's score halves. ~3km is a 40-minute walk or
// two or three metro stops (plan/form-preference-wiring.md, lodging-anchored
// scoring).
const DISTANCE_REFERENCE_KM = 3;

/** 1 at the anchor, 0.5 at DISTANCE_REFERENCE_KM, 0.25 at three times that — closer is better, never zero. */
export function distanceFactor(
  candidate: StopCandidate,
  anchor: { lat: number; lng: number },
  referenceKm = DISTANCE_REFERENCE_KM
): number {
  const km = haversineKm(anchor.lat, anchor.lng, candidate.lat, candidate.lng);
  return 1 / (1 + km / referenceKm);
}

/**
 * rating × preference × distance: rating (or popularity stand-in) times the
 * interest weight for its type, times distanceFactor from `anchor` (the
 * lodging) when given. Exported for partitionCandidatesByDay.ts, which needs
 * the same scoring to pick each day's seed candidate before this file's own
 * top-N selection runs per day.
 */
export function scoreCandidate(
  candidate: StopCandidate,
  interestWeights: Record<string, number>,
  anchor?: { lat: number; lng: number },
  referenceKm = DISTANCE_REFERENCE_KM
): number {
  const baseRating = candidate.rating ?? DEFAULT_RATING;
  const weight = candidate.type ? (interestWeights[candidate.type] ?? 1) : 1;
  return baseRating * weight * (candidate.boost ?? 1) * (anchor ? distanceFactor(candidate, anchor, referenceKm) : 1);
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

    // The rest of its group comes straight after, nearest first.
    if (next.groupId) {
      const siblings = remaining.filter((c) => c.groupId === next.groupId);
      for (const sibling of nearestNeighborOrder(siblings, next)) {
        remaining.splice(remaining.indexOf(sibling), 1);
        ordered.push(sibling);
        current = sibling;
      }
    }
  }

  return ordered;
}

/**
 * Picks `count` candidates from a Places candidate pool and orders them into
 * a walkable route, per plan/hybrid-rule-engine-scheduling.md section 3.2.
 *
 * Selection is a weighted-rating sort: each candidate scores `rating *
 * interestWeights[type] * distanceFactor` (unrated defaults to a neutral
 * rating, unweighted types to weight 1, no anchor to distance factor 1), and
 * the top `count` are kept. Ordering is
 * greedy nearest-neighbor from `origin` (or the highest-scored candidate
 * when no origin is given) — a "don't backtrack too much" heuristic, not a
 * true shortest-route solver (deliberately deferred per the plan's risk
 * notes on avoiding over-engineering the first version).
 */
export function selectAndOrderStops(
  candidates: StopCandidate[],
  options: SelectAndOrderStopsOptions
): StopCandidate[] {
  const { count, origin, interestWeights = {}, anchor } = options;
  if (count <= 0 || candidates.length === 0) return [];

  const selected = [...candidates]
    .sort((a, b) => scoreCandidate(b, interestWeights, anchor) - scoreCandidate(a, interestWeights, anchor))
    .slice(0, count);

  const startPoint = origin ?? selected[0];
  return nearestNeighborOrder(selected, startPoint);
}

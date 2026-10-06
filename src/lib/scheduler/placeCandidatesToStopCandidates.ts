import type { StopCandidate } from "@/lib/scheduler/selectAndOrderStops";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { mapPlaceTypeToCategory } from "@/lib/scheduler/mapPlaceTypeToCategory";
import { haversineKm } from "@/lib/geo";

export type PlaceCandidateToStopCandidateResult = {
  candidates: StopCandidate[];
  /** Traces a candidate's id (its real placeId) back to the full PlaceCandidate — buildDaySkeleton's StopCandidate/ScheduledStop only carry id/lat/lng/type/rating, so callers need this to get name/address/photoName back for display. */
  candidateById: Map<string, PlaceCandidate>;
};

/**
 * Adapts fetchCityRestaurants.ts's fetchNearbyPlaceCandidates() output
 * (PlaceCandidate[] — real placeId/lat/lng, resolved via getCityCenter + a
 * coordinate rather than an IATA lookup, see plan/hybrid-rule-engine-scheduling.md
 * section 0.1 point 5) into buildDaySkeleton's StopCandidate[] input.
 *
 * Simpler than hintsToStopCandidates.ts: fetchNearbyPlaceCandidatesUncached
 * already filters out results missing a placeId, and lat/lng are non-optional
 * on PlaceCandidate, so there's no coordinate gap to guard against here. Uses
 * the real placeId as the StopCandidate id (rather than a synthesized one)
 * since it's already a stable, meaningful identifier a final Stop can reuse
 * directly. A place without a rating (Pro-tier search) gets a score from its
 * popularity rank instead — see popularityScore. Guards against a duplicate
 * placeId appearing twice in the input
 * (defensive — a single fetchNearbyPlaceCandidates call can't produce one,
 * but a caller combining multiple calls' results could).
 */
// Score range for popularity rank when a pool has no ratings: Google's most
// popular result scores like a 5.0 place, its least popular like the
// scheduler's neutral 3.5 (selectAndOrderStops DEFAULT_RATING).
const POPULARITY_TOP_SCORE = 5;
const POPULARITY_BOTTOM_SCORE = 3.5;

/**
 * Stand-in score from a candidate's position in a Pro-tier Nearby Search
 * result (rankPreference: POPULARITY, no rating field — plan/form-preference-
 * wiring.md 1c-2). Needed because the scheduler re-sorts candidates (e.g.
 * partitionCandidatesByDay sorts by distance between days), so with all
 * scores tied the original popularity order would be lost.
 */
export function popularityScore(index: number, total: number): number {
  if (total <= 1) return POPULARITY_TOP_SCORE;
  return POPULARITY_TOP_SCORE - ((POPULARITY_TOP_SCORE - POPULARITY_BOTTOM_SCORE) * index) / (total - 1);
}

// How far apart two parts of one sight can be. Measured on dev.db's cached
// pools: 淺草寺 雷門 is 407m from 淺草寺, 皇居東御苑 431m from 皇居; 嵐山竹林小徑
// (917m from 嵐山) is a walk of its own.
const RELATED_PLACE_MAX_KM = 0.5;

/**
 * Whether `b` looks like part of `a` or vice versa: one name begins with the
 * other, and they're close. Not merged into one stop, because the same test
 * also pairs 倫敦塔 with 倫敦塔橋 — two different sights, 298m apart — so they
 * only stay on the same day, back to back (partitionCandidatesByDay,
 * selectAndOrderStops). Otherwise each got its own half day on different days.
 */
function isRelatedPlace(a: PlaceCandidate, b: PlaceCandidate): boolean {
  const an = a.name.trim().toLowerCase();
  const bn = b.name.trim().toLowerCase();
  if (!an || !bn || !(an.startsWith(bn) || bn.startsWith(an))) return false;
  return haversineKm(a.lat, a.lng, b.lat, b.lng) <= RELATED_PLACE_MAX_KM;
}

export function placeCandidatesToStopCandidates(
  places: PlaceCandidate[]
): PlaceCandidateToStopCandidateResult {
  const candidates: StopCandidate[] = [];
  const candidateById = new Map<string, PlaceCandidate>();
  // Google can list one sight as two places with the same name (Okinawa's
  // 沖繩戰跡國定公園 came back twice, ~200m apart, and filled a whole day),
  // so a repeated name counts as the same place: the first, more popular one stays.
  const seenNames = new Set<string>();

  places.forEach((place, index) => {
    const nameKey = place.name.trim().toLowerCase();
    if (candidateById.has(place.placeId) || seenNames.has(nameKey)) return;
    seenNames.add(nameKey);

    // Joins the group of the first (most popular) related place already kept.
    const related = candidates.find((c) => isRelatedPlace(candidateById.get(c.id)!, place));
    if (related) related.groupId ??= related.id;

    candidates.push({
      id: place.placeId,
      lat: place.lat,
      lng: place.lng,
      rating: place.rating ?? popularityScore(index, places.length),
      type: place.types ? mapPlaceTypeToCategory(place.types) : undefined,
      ...(related ? { groupId: related.groupId } : {}),
    });
    candidateById.set(place.placeId, place);
  });

  return { candidates, candidateById };
}

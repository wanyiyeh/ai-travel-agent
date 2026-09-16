import type { StopCandidate } from "@/lib/scheduler/selectAndOrderStops";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { mapPlaceTypeToCategory } from "@/lib/scheduler/mapPlaceTypeToCategory";

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
 * directly. Guards against a duplicate placeId appearing twice in the input
 * (defensive — a single fetchNearbyPlaceCandidates call can't produce one,
 * but a caller combining multiple calls' results could).
 */
export function placeCandidatesToStopCandidates(
  places: PlaceCandidate[]
): PlaceCandidateToStopCandidateResult {
  const candidates: StopCandidate[] = [];
  const candidateById = new Map<string, PlaceCandidate>();

  for (const place of places) {
    if (candidateById.has(place.placeId)) continue;

    candidates.push({
      id: place.placeId,
      lat: place.lat,
      lng: place.lng,
      rating: place.rating ?? null,
      type: place.types ? mapPlaceTypeToCategory(place.types) : undefined,
    });
    candidateById.set(place.placeId, place);
  }

  return { candidates, candidateById };
}

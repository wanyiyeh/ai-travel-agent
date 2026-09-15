import type { StopCandidate } from "@/lib/scheduler/selectAndOrderStops";
import type { RestaurantHint } from "@/lib/fetchCityRestaurants";
import { mapPlaceTypeToCategory } from "@/lib/scheduler/mapPlaceTypeToCategory";

export type HintToCandidateResult = {
  candidates: StopCandidate[];
  /** Traces a candidate's synthesized id back to its original hint (name, etc.) — buildDaySkeleton's StopCandidate/ScheduledStop carry no name field, so callers need this to render anything after the skeleton reorders candidates. */
  hintById: Map<string, RestaurantHint>;
};

/**
 * Adapts fetchCityRestaurants.ts's RestaurantHint[] (the real, production
 * candidate pool for a city) into buildDaySkeleton's StopCandidate[] input —
 * the missing piece identified while scoping Phase 3 of
 * plan/hybrid-rule-engine-scheduling.md.
 *
 * Drops any hint missing lat/lng: that field is optional on RestaurantHint
 * because existing CityPlaceHintsCache rows written before the field-mask
 * change won't have it until their 30-day TTL naturally refreshes, and
 * StopCandidate requires lat/lng. `type` comes from mapPlaceTypeToCategory
 * when the hint has Google `types`, else undefined (assignTimeSlots' flat
 * duration fallback applies, same as any other untyped candidate).
 */
export function hintsToStopCandidates(hints: RestaurantHint[]): HintToCandidateResult {
  const candidates: StopCandidate[] = [];
  const hintById = new Map<string, RestaurantHint>();

  hints.forEach((hint, index) => {
    if (typeof hint.lat !== "number" || typeof hint.lng !== "number") return;

    const id = `hint-${index}`;
    candidates.push({
      id,
      lat: hint.lat,
      lng: hint.lng,
      rating: hint.rating ?? null,
      type: hint.types ? mapPlaceTypeToCategory(hint.types) : undefined,
    });
    hintById.set(id, hint);
  });

  return { candidates, hintById };
}

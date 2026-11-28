import type { Day, StopCandidate } from "@/types/itinerary";
import { isTransitStop } from "@/lib/transitStop";
import { haversineKm } from "@/lib/geo";

/** Stops this far from the edited day's centroid count as another city. */
export const SAME_CITY_KM = 60;

export interface ReusableStop {
  dayNumber: number;
  candidate: StopCandidate;
}

/**
 * Other days' stops the day editor offers to move onto `day`: same city,
 * not a ride, and already showing a name. Names aren't stored (ADR-0004);
 * the page fills them in per day as days are opened, so a stop on a day
 * not yet opened has none and can't be listed.
 */
export function reusableStopsFor(
  days: Day[],
  day: Day,
  dayCentroid: { lat: number; lng: number } | null,
): ReusableStop[] {
  return days
    .filter((d) => d.id !== day.id)
    .flatMap((d) =>
      d.stops
        .filter((s) => {
          if (!s.name) return false;
          // The ride belongs to its own day only (ADR-0009).
          if (isTransitStop(s, d)) return false;
          // A transit day's own stops span two cities by definition
          // (departure + arrival); the city-match heuristic below
          // doesn't apply to them, so always offer them for reuse
          // regardless of which day is being edited.
          if (d.isTransitDay) return true;
          // Prefer the stop's own coordinates over the day-level
          // waypointCity tag: a transit day is tagged with its
          // departure city even though some of its stops (e.g. the
          // arrival city's attractions) are actually in the destination.
          if (dayCentroid && typeof s.lat === "number" && typeof s.lng === "number") {
            return haversineKm(s.lat, s.lng, dayCentroid.lat, dayCentroid.lng) <= SAME_CITY_KM;
          }
          // No coordinates to compare: only include when both
          // days carry a waypointCity and they actually match;
          // otherwise there's no basis for "same city" so exclude.
          return !!day.waypointCity && d.waypointCity === day.waypointCity;
        })
        .map((s) => ({
          dayNumber: d.day,
          candidate: {
            name: s.name,
            description: s.description,
            duration_minutes: s.duration_minutes,
            placeId: s.placeId,
            lat: s.lat,
            lng: s.lng,
            address: s.address,
            rating: s.rating,
          },
        })),
    );
}

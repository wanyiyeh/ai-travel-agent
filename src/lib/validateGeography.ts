import { haversineKm } from "./distanceMatrix";
import type { Itinerary } from "@/types/itinerary";
import type { ValidationIssue } from "./validateItinerary";

// Straight-line km threshold for same-day stops; >50km is almost certainly wrong city
const WARN_KM = 50;

export function validateGeography(itinerary: Itinerary): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const day of itinerary.days) {
    // On a transit day, stop 0 is the departure->arrival journey itself and is
    // expected to be far from what follows — but stops from index 1 onward are
    // all required to be in the arrival city (see itineraryGen.ts's generation
    // prompt), so they should still cluster together like a normal day.
    const startIndex = day.isTransitDay ? 2 : 1;
    for (let i = startIndex; i < day.stops.length; i++) {
      const prev = day.stops[i - 1];
      const curr = day.stops[i];
      if (!prev.lat || !prev.lng || !curr.lat || !curr.lng) continue;
      const km = haversineKm(prev.lat, prev.lng, curr.lat, curr.lng);
      if (km > WARN_KM) {
        issues.push({
          severity: "warning",
          code: "STOPS_TOO_FAR_APART",
          message: `第 ${day.day} 天：「${prev.name}」→「${curr.name}」直線距離 ${Math.round(km)} km，同天安排可能過於緊湊或地點搜尋有誤`,
          day: day.day,
        });
      }
    }
  }

  return issues;
}

// Shared helpers for the "itinerary.days is an untyped JSON blob" pattern
// that nearly every days/stops route hand-rolls: finding a day by id,
// finding a stop by id across every day (a stop can be dragged to a
// different day than the one it's stored under), and deriving which city a
// stop should be geo-biased against.

export type DaysArray = Record<string, unknown>[];

export function findDayIndex(days: DaysArray, dayId: string): number {
  return days.findIndex((d) => d.id === dayId);
}

export interface StopLocation {
  day: Record<string, unknown>;
  dayIndex: number;
  stopIndex: number;
}

export function findStopAcrossDays(days: DaysArray, stopId: string): StopLocation | null {
  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const stops = days[dayIndex].stops as Record<string, unknown>[] | undefined;
    if (!stops) continue;
    const stopIndex = stops.findIndex((s) => s.id === stopId);
    if (stopIndex >= 0) {
      return { day: days[dayIndex], dayIndex, stopIndex };
    }
  }
  return null;
}

/**
 * Which city a day's stop should be geo-biased against. Prefers waypointCity
 * (set by tagWaypointCities), falls back to transitTo. Pass `stopIndex` when
 * checking a specific stop: on a transit day, only the first stop is the
 * departure->arrival journey itself, so every later stop is required to be
 * in the arrival city (see itineraryGen.ts's generation prompt) and must be
 * geocoded against transitTo instead of the departure-tagged waypointCity.
 */
export function getCityHintForDay(day: Record<string, unknown>, stopIndex?: number): string {
  const waypointCity = typeof day.waypointCity === "string" ? day.waypointCity : "";
  const transitTo = typeof day.transitTo === "string" ? day.transitTo : "";

  if (day.isTransitDay === true && stopIndex !== undefined && stopIndex > 0 && transitTo) {
    return transitTo;
  }
  return waypointCity || transitTo || "";
}

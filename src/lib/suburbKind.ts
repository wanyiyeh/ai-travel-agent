// Kept apart from suburbTrips.ts, which searches Google: the 重新規劃 wizard
// uses this in the browser to say a stay will get a day trip.

export type SuburbKind = "day" | "half";

/**
 * The kind of trip a city's stay has room for: 3+ sightseeing days get a
 * day trip, 2 a half day, 1 none. By car or by train — a day out and back by
 * rail is as normal as driving.
 */
export function suburbKindFor(sightseeingDays: number): SuburbKind | undefined {
  if (sightseeingDays >= 3) return "day";
  if (sightseeingDays >= 2) return "half";
  return undefined;
}

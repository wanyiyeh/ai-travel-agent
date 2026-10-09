import { INDOOR_FIRST_WALK_LIMIT_KM } from "@/lib/indoorOutdoor";

// How a leg between two stops is travelled. Pure (no DB, no API), so the
// scheduler's tests use the real rules; distanceMatrix.ts re-exports these.

export type TravelMode = "driving" | "walking" | "transit" | "bicycling";

// Picks a plausible mode from straight-line distance so we don't have to
// query every mode for every leg. Thresholds are rough tourist-itinerary
// heuristics, not routing logic. An indoor-first traveler walks less
// (indoorOutdoor.ts INDOOR_FIRST_WALK_LIMIT_KM). Transit reaches a day trip
// out of town (up to 50km, suburbTrips.ts) — at 30km those legs used to be
// shown as a taxi ride.
const TRANSIT_LIMIT_KM = 60;
export function pickModeForDistance(km: number, walkLimitKm = 1.2): TravelMode {
  if (km < walkLimitKm) return "walking";
  if (km < TRANSIT_LIMIT_KM) return "transit";
  return "driving";
}

/** The form choices that change how a leg between stops is travelled. */
export type TravelPrefs = { indoorFirst?: boolean; selfDrive?: boolean };

// A self-driver still walks a short hop rather than re-parking.
const SELF_DRIVE_WALK_LIMIT_KM = 1;

/**
 * How each leg is travelled, from the traveler's choices: walk short hops
 * (500m when avoiding the sun, 1km when driving, else 1.2km), then the
 * rental car for a self-driver, otherwise transit (driving past 60km).
 */
export function modePickerFor({ indoorFirst, selfDrive }: TravelPrefs): (km: number) => TravelMode {
  const walkLimitKm = indoorFirst ? INDOOR_FIRST_WALK_LIMIT_KM : selfDrive ? SELF_DRIVE_WALK_LIMIT_KM : undefined;
  if (selfDrive) return (km) => (km < walkLimitKm! ? "walking" : "driving");
  return (km) => pickModeForDistance(km, walkLimitKm);
}

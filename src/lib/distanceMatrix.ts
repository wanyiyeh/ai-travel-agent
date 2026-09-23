import { prisma, j } from "@/lib/db";
import { haversineKm, centroid, SUSPICIOUS_DISTANCE_KM, MAX_PLAUSIBLE_DISTANCE_KM } from "@/lib/geo";

// Re-exported so existing server-side importers of this module don't need to
// change — but browser-facing code should import these from @/lib/geo
// directly, since this file also pulls in @/lib/db (PrismaClient).
export { haversineKm, centroid, SUSPICIOUS_DISTANCE_KM, MAX_PLAUSIBLE_DISTANCE_KM };

type TravelMode = "driving" | "walking" | "transit" | "bicycling";

export interface DistanceResult {
  distanceText: string;
  distanceMeters: number;
  durationText: string;
  durationSeconds: number;
}

type Location = { lat: number; lng: number } | string;

const TRAVEL_MODE: Record<TravelMode, string> = {
  driving: "DRIVE",
  walking: "WALK",
  transit: "TRANSIT",
  bicycling: "BICYCLE",
};

function toWaypoint(loc: Location) {
  return typeof loc === "string"
    ? { waypoint: { address: loc } }
    : { waypoint: { location: { latLng: { latitude: loc.lat, longitude: loc.lng } } } };
}

function formatDistanceText(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

function formatDurationText(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} mins`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest > 0 ? `${hours} hour${hours > 1 ? "s" : ""} ${rest} mins` : `${hours} hour${hours > 1 ? "s" : ""}`;
}

// ~11m precision — coarse enough that the same real-world pair always rounds
// the same way across requests, without collapsing genuinely distinct points
// (matches roundCoord's precision in fetchCityRestaurants.ts).
function roundCoord(n: number): string {
  return n.toFixed(4);
}

function locationCacheKey(loc: Location): string {
  return typeof loc === "string" ? loc : `${roundCoord(loc.lat)},${roundCoord(loc.lng)}`;
}

// Cached wrapper: this was previously the only real Google API call in the
// codebase with zero caching, unlike every Places lookup — repeatedly
// recalculating a day's transport (drag reorder, bulk-edit, delete/undo) or
// regenerating the same city re-billed Google for the exact same leg every
// time. Origin/destination order is preserved (not canonicalized) since
// duration can differ by direction.
const DISTANCE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function getDistance(
  origin: Location,
  destination: Location,
  mode: TravelMode = "driving"
): Promise<DistanceResult | null> {
  const cacheKey = `${locationCacheKey(origin)}->${locationCacheKey(destination)}:${mode}`;

  const cached = await prisma.distanceCache.findUnique({ where: { cacheKey } });
  if (cached && Date.now() - cached.updatedAt.getTime() < DISTANCE_CACHE_TTL_MS) {
    return JSON.parse(cached.distance) as DistanceResult;
  }

  const result = await fetchDistanceFromRoutesApi(origin, destination, mode);
  if (result) {
    await prisma.distanceCache.upsert({
      where: { cacheKey },
      create: { cacheKey, distance: j(result) },
      update: { distance: j(result) },
    });
  }
  return result;
}

// Uses the Routes API (Compute Route Matrix) rather than the legacy Distance
// Matrix API, per Google's migration guidance — same per-element billing but
// with a 10k/month free tier and better volume discounts. Requires the
// "Routes API" to be enabled for the project behind GOOGLE_PLACES_API_KEY.
async function fetchDistanceFromRoutesApi(
  origin: Location,
  destination: Location,
  mode: TravelMode
): Promise<DistanceResult | null> {
  try {
    const res = await fetch(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!,
          // Omitting routingPreference keeps DRIVE requests on TRAFFIC_UNAWARE
          // (Essentials pricing) instead of TRAFFIC_AWARE (Pro pricing).
          "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status,condition",
        },
        body: JSON.stringify({
          origins: [toWaypoint(origin)],
          destinations: [toWaypoint(destination)],
          travelMode: TRAVEL_MODE[mode],
        }),
      }
    );
    const data = await res.json() as
      | { distanceMeters?: number; duration?: string; condition?: string }[]
      | { error: unknown };

    if (!Array.isArray(data)) return null;
    const element = data[0];
    if (!element || element.condition !== "ROUTE_EXISTS" || element.distanceMeters == null || !element.duration) {
      return null;
    }

    const durationSeconds = parseInt(element.duration, 10);
    return {
      distanceText: formatDistanceText(element.distanceMeters),
      distanceMeters: element.distanceMeters,
      durationText: formatDurationText(durationSeconds),
      durationSeconds,
    };
  } catch {
    return null;
  }
}

// Returns distance info for each consecutive pair of stops.
// Stops without coordinates are skipped (null returned for that pair).
// `mode` can be fixed, or a function of the haversine distance (km) between
// the pair, so callers can e.g. prefer walking for short hops and driving
// for long ones without querying every mode.
export async function getDistancesForStopPairs(
  stops: { id: string; lat?: number | null; lng?: number | null }[],
  mode: TravelMode | ((km: number) => TravelMode) = "driving"
): Promise<((DistanceResult & { mode: TravelMode }) | null)[]> {
  const results = await Promise.all(
    stops.slice(1).map(async (stop, i) => {
      const prev = stops[i];
      if (!prev.lat || !prev.lng || !stop.lat || !stop.lng) return null;
      const chosenMode =
        typeof mode === "function"
          ? mode(haversineKm(prev.lat, prev.lng, stop.lat, stop.lng))
          : mode;
      let result = await getDistance(
        { lat: prev.lat, lng: prev.lng },
        { lat: stop.lat, lng: stop.lng },
        chosenMode
      );
      // Not every place has transit coverage (e.g. small towns) — fall back
      // to driving rather than reporting no transport info at all.
      if (!result && chosenMode === "transit") {
        result = await getDistance(
          { lat: prev.lat, lng: prev.lng },
          { lat: stop.lat, lng: stop.lng },
          "driving"
        );
        return result ? { ...result, mode: "driving" as const } : null;
      }
      return result ? { ...result, mode: chosenMode } : null;
    })
  );
  return results;
}

const TRANSPORT_LABEL_ZH: Record<TravelMode, string> = {
  walking: "步行",
  transit: "搭乘大眾運輸",
  driving: "搭計程車",
  bicycling: "騎自行車",
};

function formatDurationZh(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} 分鐘`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest > 0 ? `${hours} 小時 ${rest} 分鐘` : `${hours} 小時`;
}

// Picks a plausible mode from straight-line distance so we don't have to
// query every mode for every leg. Thresholds are rough tourist-itinerary
// heuristics, not routing logic.
export function pickModeForDistance(km: number): TravelMode {
  if (km < 1.2) return "walking";
  if (km < 30) return "transit";
  return "driving";
}

export function describeTransport(mode: TravelMode, durationSeconds: number): string {
  return `${TRANSPORT_LABEL_ZH[mode]}約 ${formatDurationZh(durationSeconds)}`;
}

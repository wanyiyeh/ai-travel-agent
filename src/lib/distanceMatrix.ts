import { prisma, j } from "@/lib/db";
import { googleFetch } from "@/lib/googleFetch";
import { haversineKm, centroid, SUSPICIOUS_DISTANCE_KM, MAX_PLAUSIBLE_DISTANCE_KM } from "@/lib/geo";
import { estimateTransit, isInJapan } from "@/lib/transitEstimate";

// Re-exported so existing server-side importers of this module don't need to
// change — but browser-facing code should import these from @/lib/geo
// directly, since this file also pulls in @/lib/db (PrismaClient).
export { haversineKm, centroid, SUSPICIOUS_DISTANCE_KM, MAX_PLAUSIBLE_DISTANCE_KM };

import type { TravelMode } from "@/lib/travelMode";
export { modePickerFor, pickModeForDistance, type TravelPrefs } from "@/lib/travelMode";

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
    return JSON.parse(cached.distance) as DistanceResult | null;
  }

  const result = await fetchDistanceFromRoutesApi(origin, destination, mode);
  // A confirmed "no route" (e.g. no transit coverage between two stops) is
  // cached as null, so it isn't re-billed on every generation; an API error
  // (undefined) isn't, so the next call retries.
  if (result !== undefined) {
    await prisma.distanceCache.upsert({
      where: { cacheKey },
      create: { cacheKey, distance: j(result) },
      update: { distance: j(result) },
    });
  }
  return result ?? null;
}

// Uses the Routes API (Compute Route Matrix) rather than the legacy Distance
// Matrix API, per Google's migration guidance — same per-element billing but
// with a 10k/month free tier and better volume discounts. Requires the
// "Routes API" to be enabled for the project behind GOOGLE_PLACES_API_KEY.
// Returns null when Google confirms there's no route (ROUTE_NOT_FOUND) and
// undefined for any error, so getDistance only caches the former.
async function fetchDistanceFromRoutesApi(
  origin: Location,
  destination: Location,
  mode: TravelMode
): Promise<DistanceResult | null | undefined> {
  try {
    const res = await googleFetch(
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
    if (!res.ok) return undefined;
    const data = await res.json() as
      | { distanceMeters?: number; duration?: string; condition?: string; status?: { code?: number } }[]
      | { error: unknown };

    if (!Array.isArray(data)) return undefined;
    const element = data[0];
    if (!element || element.status?.code) return undefined;
    if (element.condition === "ROUTE_NOT_FOUND") return null;
    if (element.condition !== "ROUTE_EXISTS" || element.distanceMeters == null || !element.duration) {
      return undefined;
    }

    const durationSeconds = parseInt(element.duration, 10);
    return {
      distanceText: formatDistanceText(element.distanceMeters),
      distanceMeters: element.distanceMeters,
      durationText: formatDurationText(durationSeconds),
      durationSeconds,
    };
  } catch {
    return undefined;
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
): Promise<((DistanceResult & { mode: TravelMode; estimated?: boolean }) | null)[]> {
  const results = await Promise.all(
    stops.slice(1).map(async (stop, i) => {
      const prev = stops[i];
      if (!prev.lat || !prev.lng || !stop.lat || !stop.lng) return null;
      const km = haversineKm(prev.lat, prev.lng, stop.lat, stop.lng);
      const chosenMode = typeof mode === "function" ? mode(km) : mode;
      // Google has no transit routes in Japan (transitEstimate.ts) — estimate
      // instead of paying for a request that can only fail, then a taxi route.
      if (chosenMode === "transit" && isInJapan(prev.lat, prev.lng) && isInJapan(stop.lat, stop.lng)) {
        const { durationSeconds, distanceMeters } = estimateTransit(km);
        return {
          distanceText: formatDistanceText(distanceMeters),
          distanceMeters,
          durationText: formatDurationText(durationSeconds),
          durationSeconds,
          mode: "transit" as const,
          estimated: true,
        };
      }
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


export function describeTransport(mode: TravelMode, durationSeconds: number, estimated = false, selfDrive = false): string {
  // A driving leg is a taxi for most travelers, but the rental car for a self-driver.
  const label = mode === "driving" && selfDrive ? "開車" : TRANSPORT_LABEL_ZH[mode];
  return `${label}約 ${formatDurationZh(durationSeconds)}${estimated ? "（估計）" : ""}`;
}


type TravelMode = "driving" | "walking" | "transit" | "bicycling";

export function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

// Uses the Routes API (Compute Route Matrix) rather than the legacy Distance
// Matrix API, per Google's migration guidance — same per-element billing but
// with a 10k/month free tier and better volume discounts. Requires the
// "Routes API" to be enabled for the project behind GOOGLE_PLACES_API_KEY.
export async function getDistance(
  origin: Location,
  destination: Location,
  mode: TravelMode = "driving"
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
export async function getDistancesForStopPairs(
  stops: { id: string; lat?: number | null; lng?: number | null }[],
  mode: TravelMode = "driving"
): Promise<(DistanceResult | null)[]> {
  const results = await Promise.all(
    stops.slice(1).map((stop, i) => {
      const prev = stops[i];
      if (!prev.lat || !prev.lng || !stop.lat || !stop.lng) return Promise.resolve(null);
      return getDistance(
        { lat: prev.lat, lng: prev.lng },
        { lat: stop.lat, lng: stop.lng },
        mode
      );
    })
  );
  return results;
}

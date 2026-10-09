// Google's Routes API has no transit routes in Japan: 62 of 64 cached
// Japanese TRANSIT requests came back ROUTE_NOT_FOUND, and a daytime check
// with a departure time failed in Tokyo and Osaka while Seoul worked. Every
// leg beyond walking distance fell back to 「搭計程車」, where a visitor would
// take the train. In Japan, transit time is estimated from distance instead,
// without calling the API at all.

/**
 * Whether a point is in Japan, by coordinates. A rough outline that keeps
 * Korea (Busan 129.1E, Jeju) and Russia's coast (Vladivostok 131.9E, 43.1N)
 * out; the Goto islands and Tsushima fall outside too, and just keep the old
 * fallback.
 */
export function isInJapan(lat: number, lng: number): boolean {
  if (lat < 24 || lat > 45.6) return false;
  if (lat < 30) return lng > 122.9 && lng < 131.5; // Okinawa and the Ryukyus
  if (lat <= 34) return lng >= 129.5 && lng < 146; // Kyushu
  if (lat <= 41.3) return lng >= 130.8 && lng < 146; // Honshu, Shikoku
  return lng >= 139.3 && lng < 146; // Hokkaido
}

// Walking to the station and waiting.
const OVERHEAD_MINUTES = 10;
// Local trains with stops; beyond 10km, express lines cover distance faster.
const MINUTES_PER_KM_NEAR = 2.5;
const MINUTES_PER_KM_FAR = 1.5;
const NEAR_KM = 10;
// Tracks wind; straight-line distance understates the ride.
const ROUTE_FACTOR = 1.3;

/**
 * A transit leg estimated from straight-line distance, rounded to 5 minutes
 * since it's a guess: Shinjuku→Shibuya (3.4km) 20 min, Tokyo
 * Station→Shibuya (6.8km) 25, Shinjuku→Asakusa (9.3km) 35.
 */
export function estimateTransit(km: number): { durationSeconds: number; distanceMeters: number } {
  const minutes =
    OVERHEAD_MINUTES + MINUTES_PER_KM_NEAR * Math.min(km, NEAR_KM) + MINUTES_PER_KM_FAR * Math.max(0, km - NEAR_KM);
  const rounded = Math.max(10, Math.round(minutes / 5) * 5);
  return { durationSeconds: rounded * 60, distanceMeters: Math.round(km * 1000 * ROUTE_FACTOR) };
}

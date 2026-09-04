import { getCityCenter } from "@/lib/placesTextSearch";
import { haversineKm, SUSPICIOUS_DISTANCE_KM } from "@/lib/distanceMatrix";

// Beyond this, an attraction is not confidently "in" any candidate city, so
// the caller should ask the user to confirm/pick instead of silently
// assigning it. Same threshold convention as the suspicious-stop centroid
// check (enrich-all-stops/route.ts, stop-suggestions/route.ts) — see
// SUSPICIOUS_DISTANCE_KM's doc comment in distanceMatrix.ts.
export const NEAREST_CITY_KM_THRESHOLD = SUSPICIOUS_DISTANCE_KM;

// There's no reverse-geocode-to-city helper anywhere in this codebase — this
// resolves each candidate city's center (cached) and picks the closest one,
// used to auto-assign a searched attraction to a city in the restructure flow.
export async function nearestCity(
  point: { lat: number; lng: number },
  candidateCityNames: string[],
  apiKey: string,
): Promise<{ city: string; distanceKm: number } | null> {
  const centers = await Promise.all(
    candidateCityNames.map(async (city) => ({ city, center: await getCityCenter(city, apiKey) })),
  );

  let best: { city: string; distanceKm: number } | null = null;
  for (const { city, center } of centers) {
    if (!center) continue;
    const distanceKm = haversineKm(point.lat, point.lng, center.lat, center.lng);
    if (!best || distanceKm < best.distanceKm) {
      best = { city, distanceKm };
    }
  }
  return best;
}

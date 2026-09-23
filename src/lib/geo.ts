// Pure, browser-safe geo helpers. Kept separate from distanceMatrix.ts
// (which imports @/lib/db for its Prisma-backed cache) so client components
// that only need distance math don't pull PrismaClient into the browser bundle.

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

// Beyond this, a candidate/stop is not confidently "in" the same city as its
// siblings, so callers should flag it as suspicious (enrich-all-stops,
// stop-suggestions) or ask the user to confirm/pick instead of silently
// assigning it (nearestCity). Single source of truth for this convention —
// previously three separate 80 constants that had to be kept in sync by hand.
export const SUSPICIOUS_DISTANCE_KM = 80;

// Beyond this, an attraction isn't just ambiguous between candidate cities —
// it isn't near any of them at all, so it almost certainly doesn't belong to
// this trip (e.g. searching "Paris" while restructuring a Kathmandu-only
// itinerary). nearestCity() still reports the closest candidate, but callers
// should reject the match outright here instead of offering manual
// disambiguation, which would otherwise let a user pin a wildly out-of-trip
// place onto any city they click.
export const MAX_PLAUSIBLE_DISTANCE_KM = 500;

export function centroid(pts: { lat: number; lng: number }[]): { lat: number; lng: number } {
  const sum = pts.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / pts.length, lng: sum.lng / pts.length };
}

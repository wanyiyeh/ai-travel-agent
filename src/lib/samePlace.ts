import { haversineKm } from "@/lib/geo";

// Google sometimes lists one sight twice: 「北海坑道」 and 「北海坑道搖櫓」 (its
// rowing boats) are 50m apart, and a 馬祖 day had both. Close together with one
// name inside the other counts as the same place.
const SAME_PLACE_KM = 0.3;

type Place = { name: string; lat: number; lng: number };

const normalize = (name: string) => name.replace(/[\s・·()（）「」]/g, "").toLowerCase();

export function isSamePlace(a: Place, b: Place): boolean {
  const [x, y] = [normalize(a.name), normalize(b.name)];
  const shorter = x.length <= y.length ? x : y;
  return shorter.length >= 2 && (x.includes(y) || y.includes(x)) && haversineKm(a.lat, a.lng, b.lat, b.lng) <= SAME_PLACE_KM;
}

/** Each place once. The shorter name — the place itself rather than a part of it — is kept, where the first stood. */
export function withoutSamePlace<T extends Place>(places: T[]): T[] {
  const kept: T[] = [];
  for (const place of places) {
    const twin = kept.findIndex((k) => isSamePlace(k, place));
    if (twin === -1) kept.push(place);
    else if (normalize(place.name).length < normalize(kept[twin].name).length) kept[twin] = place;
  }
  return kept;
}

/** Places that aren't one already visited under another listing: 北海坑道搖櫓 after a day at 北海坑道. */
export function notVisited<T extends Place>(places: T[], visited: Place[]): T[] {
  return places.filter((p) => !visited.some((v) => isSamePlace(v, p)));
}

import { haversineKm } from "@/lib/geo";

// 獨旅 (plan/form-preference-wiring.md 1.5): Google has no "good for one"
// or "counter seating" field, so this goes by type and name.

// Places where one person eats easily — counter seats, one bowl or one set
// each — all types seen in cached results. Any of a place's types counts,
// not just the first: Google ordered 藏壽司 [family_restaurant,
// sushi_restaurant, ...] (the same lesson as teamLab's indoor/outdoor).
const SOLO_FRIENDLY_TYPES = new Set([
  "ramen_restaurant",
  "noodle_shop",
  "sushi_restaurant",
  "japanese_curry_restaurant",
  "tonkatsu_restaurant",
  "yakitori_restaurant",
  "food_court",
  "fast_food_restaurant",
  "hamburger_restaurant",
  "sandwich_shop",
]);
// Udon and soba shops often say only japanese_restaurant (Udon Shin, 麵散);
// their names say noodles.
const NOODLE_NAME = /麵|烏龍|うどん|蕎麥|そば|ラーメン|丼|udon|soba|ramen|noodle/i;

// Shared pots and grills: no place for one (plan 1.5). Dropped from a solo
// trip's lunches and dinners — asking the model to avoid them didn't keep
// out 海底撈火鍋 or a 牛舌 yakiniku.
const GROUP_DINING_TYPES = new Set(["hot_pot_restaurant", "yakiniku_restaurant", "korean_barbecue_restaurant", "buffet_restaurant"]);

type Eatery = { name?: string; types?: string[] };

export function isSoloFriendly(place: Eatery): boolean {
  return Boolean(place.types?.some((t) => SOLO_FRIENDLY_TYPES.has(t)) || (place.name && NOODLE_NAME.test(place.name)));
}

/** A shared pot or grill, unless it's also something one person eats at. */
export function isGroupDining(place: Eatery): boolean {
  return Boolean(place.types?.some((t) => GROUP_DINING_TYPES.has(t))) && !isSoloFriendly(place);
}

/** For a solo trip: places easy to eat at alone first, the rest in order, shared pots and grills left out. */
export function forSoloTraveler<T extends Eatery>(places: T[]): T[] {
  const kept = places.filter((p) => !isGroupDining(p));
  return [...kept.filter(isSoloFriendly), ...kept.filter((p) => !isSoloFriendly(p))];
}

// A lodging this close to a station counts as near one.
const NEAR_STATION_KM = 0.5;

/** Lodging within NEAR_STATION_KM of a station first; the rest stay, in their order. */
export function nearStationFirst<T extends { lat: number; lng: number }>(lodging: T[], stations: { lat: number; lng: number }[]): T[] {
  const near = (p: T) => stations.some((s) => haversineKm(s.lat, s.lng, p.lat, p.lng) <= NEAR_STATION_KM);
  return [...lodging.filter(near), ...lodging.filter((p) => !near(p))];
}

import { fetchNearbyPlaceCandidates, type PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { haversineKm } from "@/lib/geo";
import type { DayFixedEvents } from "@/lib/fixedEvents";

// 郊區的一日遊和半日遊 (plan/form-preference-wiring.md 1.4, phase 3b): one
// day out of the city for a stay long enough to spare it.

export type SuburbKind = "day" | "half";

// Google types per interest. Each group is its own Nearby Search: one type
// Google doesn't know makes it reject the whole request, and `vineyard` /
// `brewery` couldn't be confirmed, so 酒 is wineries only.
const SUBURB_GROUPS = {
  land: ["national_park", "state_park", "hiking_area", "adventure_sports_center", "ski_resort"],
  water: ["beach", "marina", "water_park", "fishing_charter"],
  food: ["farm", "ranch"],
  alcohol: ["winery"],
} as const;
export type SuburbGroup = keyof typeof SUBURB_GROUPS;

/**
 * Which kinds of suburb place the traveler wants, from their interests and
 * drinks. Without any, the outdoors (land and water) — a "popular suburb
 * sight" search near the city mostly returns downtown places instead.
 * The old 冒險戶外 counts as land.
 */
export function suburbGroupsFor(interests: string[], drinks: string[] = []): SuburbGroup[] {
  const groups: SuburbGroup[] = [];
  if (interests.includes("land") || interests.includes("adventure")) groups.push("land");
  if (interests.includes("water")) groups.push("water");
  if (interests.includes("food")) groups.push("food");
  if (drinks.includes("alcohol")) groups.push("alcohol");
  return groups.length > 0 ? groups : ["land", "water"];
}

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

// Out of town, but within about an hour or an hour and a half by train or
// car — 50km is also Nearby Search's largest radius.
const MIN_SUBURB_KM = 15;
export const MAX_SUBURB_KM = 50;

/**
 * The most popular place of the wanted kinds between MIN_SUBURB_KM and
 * maxKm from the city center, not used yet. Groups are searched in turn
 * and their results interleaved, so each interest gets a look in. A farm is
 * only taken when Google also calls it a tourist attraction — plenty of
 * farms aren't open to visitors. `accept` turns a place down for the next
 * one in the same order — out of season (climate.ts), or in a town the
 * route already stays in; it's only asked about the places actually reached.
 */
export async function findSuburbPlace(
  center: { lat: number; lng: number },
  apiKey: string,
  groups: SuburbGroup[],
  maxKm: number,
  usedPlaceIds: Set<string>,
  accept: (place: PlaceCandidate) => Promise<boolean> = async () => true
): Promise<{ place: PlaceCandidate; group: SuburbGroup } | undefined> {
  const pools = await Promise.all(
    groups.map(async (group) => {
      const places = await fetchNearbyPlaceCandidates(center, apiKey, [...SUBURB_GROUPS[group]], maxKm * 1000, 20).catch(
        () => [] as PlaceCandidate[]
      );
      return places
        .filter((p) => !usedPlaceIds.has(p.placeId))
        .filter((p) => {
          const km = haversineKm(center.lat, center.lng, p.lat, p.lng);
          return km >= MIN_SUBURB_KM && km <= maxKm;
        })
        .filter((p) => group !== "food" || p.types?.includes("tourist_attraction"))
        .map((place) => ({ place, group }));
    })
  );
  for (let i = 0; i < Math.max(0, ...pools.map((p) => p.length)); i++) {
    for (const pool of pools) if (pool[i] && (await accept(pool[i].place))) return pool[i];
  }
  return undefined;
}

// A suburb place this close to another city on the route is a visit to that
// city, which already gets its own days (a Sapporo day trip went to 小樽's
// harbor, on a route staying 2 nights in 小樽).
const OTHER_CITY_KM = 15;
export function isInOtherCity(place: { lat: number; lng: number }, otherCityCenters: { lat: number; lng: number }[]): boolean {
  return otherCityCenters.some((c) => haversineKm(c.lat, c.lng, place.lat, place.lng) <= OTHER_CITY_KM);
}

const DAY_TRIP_MINUTES = 300;
const HALF_DAY_MINUTES = 150;
// Getting there and back, on top of the visit.
const TRAVEL_ALLOWANCE_MINUTES = 60;

/**
 * The trip as a block at the start of the day: a day trip fills it to
 * `dayEndMinute`, so no city stops are added; a half day leaves the
 * afternoon to the city. Drinking at a winery gets a driver's reminder.
 */
export function suburbTripEvent(
  place: PlaceCandidate,
  group: SuburbGroup,
  kind: SuburbKind,
  dayStartMinute: number,
  dayEndMinute: number,
  selfDrive: boolean
): DayFixedEvents[number] {
  const minutes = kind === "day" ? DAY_TRIP_MINUTES : HALF_DAY_MINUTES;
  const notes = [
    kind === "day" ? "郊區一日遊，整天待在這一帶" : "半日遊：上午在郊區，下午回市區",
    selfDrive ? "開車前往" : "搭火車或巴士當天往返",
    ...(group === "alcohol" && selfDrive ? ["開車的人不能試飲"] : []),
  ];
  return {
    block: {
      startMinute: dayStartMinute,
      endMinute: kind === "day" ? dayEndMinute : dayStartMinute + minutes + TRAVEL_ALLOWANCE_MINUTES,
    },
    stop: {
      id: crypto.randomUUID(),
      placeId: place.placeId,
      name: place.name,
      description: notes.join("。"),
      duration_minutes: minutes,
      time_of_day: "morning",
      lat: place.lat,
      lng: place.lng,
      address: place.address,
      rating: place.rating ?? null,
      photoName: place.photoName ?? null,
    },
  };
}

/** Which of a city's sightseeing days takes the trip: not the first (often the arrival), and a day free of fixed events. */
export function suburbDayIndex(dayEventCounts: number[]): number | undefined {
  const free = dayEventCounts.map((n, i) => (i > 0 && n === 0 ? i : -1)).filter((i) => i >= 0);
  return free[0];
}

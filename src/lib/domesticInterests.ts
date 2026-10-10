import { fetchNearbyPlaceCandidates, searchTextCandidates, type PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { haversineKm } from "@/lib/geo";
import { COPY_PENDING } from "@/lib/copyPending";
import type { DayFixedEvents } from "@/lib/fixedEvents";

// 國內 interests (plan/form-preference-wiring.md 1.10, phase 5b): 夜市, 溫泉,
// 露營 (老街 is a theme day, dayThemes.ts). Google has no type for a night
// market or a hot-spring hotel, so those are text searches (Pro, cached).

const NIGHT_MARKET_NAME = /夜市/;
const NIGHT_MARKET_KM = 15;

/** How many evenings a city's stay gets a night market: one, two from three nights. */
export function nightMarketCount(sightseeingDays: number): number {
  return sightseeingDays >= 3 ? 2 : sightseeingDays >= 1 ? 1 : 0;
}

/** Which of a city's sightseeing days get one: the last first, then the first. */
export function nightMarketDays(sightseeingDays: number): number[] {
  const count = nightMarketCount(sightseeingDays);
  return count === 2 ? [0, sightseeingDays - 1] : count === 1 ? [sightseeingDays - 1] : [];
}

/** The city's night markets (one text search), not used yet, most popular first. */
export async function findNightMarkets(
  center: { lat: number; lng: number },
  apiKey: string,
  count: number,
  usedPlaceIds: Set<string>
): Promise<PlaceCandidate[]> {
  if (count === 0) return [];
  const found = await searchTextCandidates("夜市", center, apiKey, NIGHT_MARKET_KM * 1000).catch(() => [] as PlaceCandidate[]);
  return found
    .filter((p) => NIGHT_MARKET_NAME.test(p.name) && !usedPlaceIds.has(p.placeId))
    .filter((p) => haversineKm(center.lat, center.lng, p.lat, p.lng) <= NIGHT_MARKET_KM)
    .slice(0, count);
}

/**
 * A night market as the evening's dinner. Each opens on its own weekdays —
 * that's an Enterprise field, so the note asks the traveler to check.
 */
export function nightMarketDinner(place: PlaceCandidate): Record<string, unknown> {
  return {
    name: place.name,
    description: "晚上逛夜市吃小吃當晚餐。夜市各有固定營業日，出發前確認",
    // missingCopy.ts writes a line about the market in front of the note.
    [COPY_PENDING]: true,
    placeId: place.placeId,
    lat: place.lat,
    lng: place.lng,
    address: place.address,
    rating: place.rating ?? null,
    photoName: place.photoName ?? null,
  };
}

// 北投, 礁溪 and 知本 sit outside their cities' centres.
const HOT_SPRING_KM = 20;
const HOT_SPRING_NAME = /溫泉|温泉|湯/;

/** Hot-spring hotels near the city (one text search for lodging), to stay at first. */
export async function findHotSpringLodging(center: { lat: number; lng: number }, apiKey: string): Promise<PlaceCandidate[]> {
  const found = await searchTextCandidates("溫泉飯店", center, apiKey, HOT_SPRING_KM * 1000, "lodging").catch(
    () => [] as PlaceCandidate[]
  );
  return found.filter((p) => haversineKm(center.lat, center.lng, p.lat, p.lng) <= HOT_SPRING_KM);
}

/** Whether a lodging's name says it's a hot-spring stay. */
export function isHotSpringStay(name: unknown): boolean {
  return typeof name === "string" && HOT_SPRING_NAME.test(name);
}

/**
 * Somewhere to soak for a city with no hot-spring stay: a public bath or a
 * place named for its springs, not a hotel.
 */
export async function findHotSpringSoak(
  center: { lat: number; lng: number },
  apiKey: string,
  usedPlaceIds: Set<string>
): Promise<PlaceCandidate | undefined> {
  const found = await searchTextCandidates("溫泉", center, apiKey, HOT_SPRING_KM * 1000).catch(() => [] as PlaceCandidate[]);
  return found.find(
    (p) =>
      !usedPlaceIds.has(p.placeId) &&
      !p.types?.includes("lodging") &&
      (p.types?.includes("public_bath") || HOT_SPRING_NAME.test(p.name)) &&
      haversineKm(center.lat, center.lng, p.lat, p.lng) <= HOT_SPRING_KM
  );
}

// An early-evening soak, before dinner.
const SOAK_START_MINUTE = 17 * 60;
const SOAK_MINUTES = 90;

export function hotSpringSoakEvent(place: PlaceCandidate): DayFixedEvents[number] {
  return {
    block: { startMinute: SOAK_START_MINUTE, endMinute: SOAK_START_MINUTE + SOAK_MINUTES },
    stop: {
      id: crypto.randomUUID(),
      placeId: place.placeId,
      name: place.name,
      description: "傍晚泡湯",
      [COPY_PENDING]: true,
      duration_minutes: SOAK_MINUTES,
      time_of_day: "evening",
      lat: place.lat,
      lng: place.lng,
      address: place.address,
      rating: place.rating ?? null,
      photoName: place.photoName ?? null,
    },
  };
}

// Campsites are mostly up in the hills, within about an hour's drive. The
// straight line lies there: 皇后鎮森林三峽 is under 40km from 宜蘭 but over the
// 雪山 range, 1-2 hours by road. So a site in the city's own county first
// (its address says so: 「宜蘭縣員山鄉…」), and only a close one otherwise.
const CAMPSITE_KM = 40;
const CAMPSITE_ELSEWHERE_KM = 20;

/** The site to take from a search's results: in the city's county first, else close by. */
export function pickCampsite(
  sites: PlaceCandidate[],
  center: { lat: number; lng: number },
  city: string
): PlaceCandidate | undefined {
  const km = (p: PlaceCandidate) => haversineKm(center.lat, center.lng, p.lat, p.lng);
  const sameCounty = (p: PlaceCandidate) => p.address.replace(/臺/g, "台").includes(city);
  return sites.find((p) => sameCounty(p) && km(p) <= CAMPSITE_KM) ?? sites.find((p) => km(p) <= CAMPSITE_ELSEWHERE_KM);
}

/** A campsite within a drive of the city: Google's campground type, else a text search. */
export async function findCampsite(
  center: { lat: number; lng: number },
  apiKey: string,
  city: string
): Promise<PlaceCandidate | undefined> {
  const byType = await fetchNearbyPlaceCandidates(center, apiKey, ["campground"], CAMPSITE_KM * 1000, 20, "pro").catch(
    () => [] as PlaceCandidate[]
  );
  const typed = pickCampsite(byType, center, city);
  if (typed) return typed;
  const byText = await searchTextCandidates("露營區", center, apiKey, CAMPSITE_KM * 1000).catch(() => [] as PlaceCandidate[]);
  return pickCampsite(byText, center, city);
}

/** A night at a campsite as that night's lodging. */
export function campsiteStay(place: PlaceCandidate, city: string): Record<string, unknown> {
  return {
    name: place.name,
    area: city,
    reason: "露營：自備或租借帳篷，出發前確認營區設備和天氣",
    placeId: place.placeId,
    lat: place.lat,
    lng: place.lng,
    address: place.address,
    rating: place.rating ?? null,
  };
}

import { haversineKm } from "@/lib/distanceMatrix";

const NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby";

export type BudgetLevel = "budget" | "moderate" | "luxury";

// Shared with placesTextSearch's Text Search results — Google reports price
// level as one of these enum strings from both Nearby Search and Text Search.
export const PRICE_LEVEL_MAP: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export interface RestaurantHint {
  name: string;
  rating?: number;
}

const BUDGET_TO_PRICE_LEVELS: Record<BudgetLevel, string[]> = {
  budget:   ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"],
  moderate: ["PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE"],
  luxury:   ["PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"],
};

const BUDGET_LABEL: Record<BudgetLevel, string> = {
  budget:   "平價",
  moderate: "中等",
  luxury:   "高級",
};

// Table A dining subtypes (see docs/google-places-types.md). Most `restaurant`
// results don't open for breakfast, so breakfast gets its own includedTypes
// query — using Table A's dedicated breakfast_restaurant/brunch_restaurant
// types (not just cafe/bakery) so it isn't limited to Western-style breakfast
// and also surfaces local morning diners (e.g. Japanese teishoku spots).
const BREAKFAST_TYPES = ["breakfast_restaurant", "brunch_restaurant", "cafe", "bakery"];

// Snack/afternoon-tea slot — dessert-appropriate Table A types (see
// docs/google-places-types.md). Overlaps with BREAKFAST_TYPES (cafe/bakery),
// which is fine: the same physical venue can surface in both hint lists, and
// the generation prompt's anti-repeat rule (not this type set) is what stops
// the LLM from picking the same store for both meals.
const SNACK_TYPES = ["cafe", "bakery", "ice_cream_shop"];

// Lunch/dinner still centre on `restaurant`, widened per budget so a
// "budget" trip also surfaces fast_food_restaurant and a "luxury" trip
// surfaces fine_dining_restaurant.
const MAIN_MEAL_TYPES_BY_BUDGET: Record<BudgetLevel, string[]> = {
  budget:   ["restaurant", "fast_food_restaurant"],
  moderate: ["restaurant"],
  luxury:   ["restaurant", "fine_dining_restaurant"],
};

function getMainMealTypes(budget?: BudgetLevel): string[] {
  return budget ? MAIN_MEAL_TYPES_BY_BUDGET[budget] : ["restaurant"];
}

/** Place Types to search for a given meal slot — breakfast uses BREAKFAST_TYPES, snack uses SNACK_TYPES, lunch/dinner use the budget-aware main-meal types. */
export function getMealPlaceTypes(mealType: "breakfast" | "lunch" | "dinner" | "snack", budget?: BudgetLevel): string[] {
  if (mealType === "breakfast") return BREAKFAST_TYPES;
  if (mealType === "snack") return SNACK_TYPES;
  return getMainMealTypes(budget);
}

// Table A lodging subtypes (see docs/google-places-types.md), picked per budget
// so a "budget" trip surfaces hostels/guest houses instead of resort hotels.
const LODGING_TYPES_BY_BUDGET: Record<BudgetLevel, string[]> = {
  budget:   ["hostel", "guest_house", "bed_and_breakfast", "motel", "lodging"],
  moderate: ["hotel", "guest_house", "lodging"],
  luxury:   ["resort_hotel", "hotel", "lodging"],
};

export function getLodgingTypes(budget?: BudgetLevel): string[] {
  return budget ? LODGING_TYPES_BY_BUDGET[budget] : ["hotel", "resort_hotel", "guest_house", "lodging"];
}

export function getPriceLevels(budget?: BudgetLevel): string[] | undefined {
  return budget ? BUDGET_TO_PRICE_LEVELS[budget] : undefined;
}

// City-centre coordinates for every IATA code offered in the destination
// picker (src/app/page.tsx's IATA_CITY) and src/lib/iataCity.ts's
// IATA_CITY_ZH — kept in sync with those so a city selectable in the UI
// always has real Nearby Search grounding here too. A code missing from this
// table silently disables the "verified place" hint lists for that city
// (see fetchCityRestaurants/fetchCityBreakfastPlaces/fetchCitySnackPlaces/
// fetchCityAttractions below), which lets the LLM hallucinate places with no
// real-world anchor — e.g. NGO (Nagoya) being absent previously let a US
// Ghirardelli chocolate shop get suggested as a Nagoya snack stop.
const IATA_COORDS: Record<string, { lat: number; lng: number }> = {
  // East Asia
  NRT: { lat: 35.6762, lng: 139.6503 },
  HND: { lat: 35.6762, lng: 139.6503 },
  KIX: { lat: 34.6937, lng: 135.5023 },
  NGO: { lat: 35.1815, lng: 136.9066 },
  CTS: { lat: 43.0618, lng: 141.3545 },
  FUK: { lat: 33.5904, lng: 130.4017 },
  OKA: { lat: 26.2124, lng: 127.6809 },
  ICN: { lat: 37.5665, lng: 126.9780 },
  GMP: { lat: 37.5665, lng: 126.9780 },
  PUS: { lat: 35.1796, lng: 129.0756 },
  PEK: { lat: 39.9042, lng: 116.4074 },
  PKX: { lat: 39.9042, lng: 116.4074 },
  PVG: { lat: 31.2304, lng: 121.4737 },
  SHA: { lat: 31.2304, lng: 121.4737 },
  CAN: { lat: 23.1291, lng: 113.2644 },
  HKG: { lat: 22.3193, lng: 114.1694 },
  TPE: { lat: 25.0330, lng: 121.5654 },
  KHH: { lat: 22.6273, lng: 120.3014 },
  RMQ: { lat: 24.1477, lng: 120.6736 },
  // Southeast Asia
  SIN: { lat: 1.3521, lng: 103.8198 },
  KUL: { lat: 3.1390, lng: 101.6869 },
  BKK: { lat: 13.7563, lng: 100.5018 },
  DMK: { lat: 13.7563, lng: 100.5018 },
  HKT: { lat: 7.8804, lng: 98.3923 },
  CNX: { lat: 18.7883, lng: 98.9853 },
  SGN: { lat: 10.8231, lng: 106.6297 },
  HAN: { lat: 21.0285, lng: 105.8542 },
  DAD: { lat: 16.0544, lng: 108.2022 },
  DPS: { lat: -8.6705, lng: 115.2126 },
  CGK: { lat: -6.2088, lng: 106.8456 },
  REP: { lat: 13.3671, lng: 103.8448 },
  PNH: { lat: 11.5564, lng: 104.9282 },
  // Oceania
  PER: { lat: -31.9505, lng: 115.8605 },
  MEL: { lat: -37.8136, lng: 144.9631 },
  SYD: { lat: -33.8688, lng: 151.2093 },
  BNE: { lat: -27.4698, lng: 153.0251 },
  AKL: { lat: -36.8485, lng: 174.7633 },
  // Europe
  LHR: { lat: 51.5074, lng: -0.1278 },
  LGW: { lat: 51.5074, lng: -0.1278 },
  MAN: { lat: 53.4808, lng: -2.2426 },
  EDI: { lat: 55.9533, lng: -3.1883 },
  DUB: { lat: 53.3498, lng: -6.2603 },
  CDG: { lat: 48.8566, lng: 2.3522 },
  ORY: { lat: 48.8566, lng: 2.3522 },
  LYS: { lat: 45.7640, lng: 4.8357 },
  NCE: { lat: 43.7102, lng: 7.2620 },
  AMS: { lat: 52.3676, lng: 4.9041 },
  FRA: { lat: 50.1109, lng: 8.6821 },
  MUC: { lat: 48.1351, lng: 11.5820 },
  BER: { lat: 52.5200, lng: 13.4050 },
  HAM: { lat: 53.5511, lng: 9.9937 },
  VIE: { lat: 48.2082, lng: 16.3738 },
  FCO: { lat: 41.9028, lng: 12.4964 },
  MXP: { lat: 45.4642, lng: 9.1900 },
  VCE: { lat: 45.4408, lng: 12.3155 },
  NAP: { lat: 40.8518, lng: 14.2681 },
  BCN: { lat: 41.3874, lng: 2.1686 },
  MAD: { lat: 40.4168, lng: -3.7038 },
  LIS: { lat: 38.7223, lng: -9.1393 },
  ATH: { lat: 37.9838, lng: 23.7275 },
  HEL: { lat: 60.1699, lng: 24.9384 },
  CPH: { lat: 55.6761, lng: 12.5683 },
  ARN: { lat: 59.3293, lng: 18.0686 },
  OSL: { lat: 59.9139, lng: 10.7522 },
  PRG: { lat: 50.0755, lng: 14.4378 },
  BUD: { lat: 47.4979, lng: 19.0402 },
  BTS: { lat: 48.1486, lng: 17.1077 },
  LJU: { lat: 46.0569, lng: 14.5058 },
  ZAG: { lat: 45.8150, lng: 15.9819 },
  DBV: { lat: 42.6507, lng: 18.0944 },
  SJJ: { lat: 43.8563, lng: 18.4131 },
  BEG: { lat: 44.7866, lng: 20.4489 },
  SOF: { lat: 42.6977, lng: 23.3219 },
  OTP: { lat: 44.4268, lng: 26.1025 },
  WAW: { lat: 52.2297, lng: 21.0122 },
  KRK: { lat: 50.0647, lng: 19.9450 },
  ZRH: { lat: 47.3769, lng: 8.5417 },
  GVA: { lat: 46.2044, lng: 6.1432 },
  BRU: { lat: 50.8503, lng: 4.3517 },
  IST: { lat: 41.0082, lng: 28.9784 },
  // Middle East
  DXB: { lat: 25.2048, lng: 55.2708 },
  AUH: { lat: 24.4539, lng: 54.3773 },
  DOH: { lat: 25.2854, lng: 51.5310 },
  // Africa
  CAI: { lat: 30.0444, lng: 31.2357 },
  CMN: { lat: 33.5731, lng: -7.5898 },
  CPT: { lat: -33.9249, lng: 18.4241 },
  JNB: { lat: -26.2041, lng: 28.0473 },
  // North America
  JFK: { lat: 40.7128, lng: -74.0060 },
  MIA: { lat: 25.7617, lng: -80.1918 },
  LAX: { lat: 34.0522, lng: -118.2437 },
  SFO: { lat: 37.7749, lng: -122.4194 },
  ORD: { lat: 41.8781, lng: -87.6298 },
  SEA: { lat: 47.6062, lng: -122.3321 },
  YYZ: { lat: 43.6532, lng: -79.3832 },
  YVR: { lat: 49.2827, lng: -123.1207 },
};

/**
 * Nearby Search restricted to a set of Table A place types, returning just
 * name/rating hints. Shared by the restaurant/breakfast/attraction fetchers
 * below — they differ only in which types, radius and price levels they pass.
 * Returns empty array on any error so callers can gracefully degrade.
 */
async function searchNearbyHints(
  coords: { lat: number; lng: number },
  apiKey: string,
  includedTypes: string[],
  radius: number,
  maxCount: number,
  priceLevels?: string[],
): Promise<RestaurantHint[]> {
  try {
    const res = await fetch(NEARBY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.rating",
      },
      body: JSON.stringify({
        includedTypes,
        maxResultCount: maxCount,
        locationRestriction: {
          circle: {
            center: { latitude: coords.lat, longitude: coords.lng },
            radius,
          },
        },
        rankPreference: "POPULARITY",
        ...(priceLevels ? { priceLevels } : {}),
      }),
    });

    if (!res.ok) {
      console.warn(`[Places API] ${includedTypes.join(",")} HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    return (data.places ?? [])
      .map((p: { displayName?: { text?: string }; rating?: number }) => ({
        name: p.displayName?.text ?? "",
        rating: p.rating,
      }))
      .filter((r: RestaurantHint) => r.name.length > 0);
  } catch (err) {
    console.warn(`[Places API] ${includedTypes.join(",")} fetch failed:`, err);
    return [];
  }
}

/**
 * Fetch top lunch/dinner restaurants near a city via Google Places Nearby Search.
 * Returns empty array on any error so callers can gracefully degrade.
 */
export async function fetchCityRestaurants(
  iataCode: string,
  apiKey: string,
  budget?: BudgetLevel,
  maxCount = 20,
): Promise<RestaurantHint[]> {
  const coords = IATA_COORDS[iataCode];
  if (!coords) return [];

  return searchNearbyHints(coords, apiKey, getMainMealTypes(budget), 8000, maxCount, getPriceLevels(budget));
}

/**
 * Fetch top breakfast-appropriate places (cafés/bakeries) near a city.
 * Kept separate from fetchCityRestaurants because `restaurant` results are
 * mostly lunch/dinner venues that don't serve breakfast.
 */
export async function fetchCityBreakfastPlaces(
  iataCode: string,
  apiKey: string,
  maxCount = 15,
): Promise<RestaurantHint[]> {
  const coords = IATA_COORDS[iataCode];
  if (!coords) return [];

  return searchNearbyHints(coords, apiKey, BREAKFAST_TYPES, 8000, maxCount);
}

/**
 * Fetch top snack/afternoon-tea-appropriate places (cafés/bakeries/ice cream
 * shops) near a city. Kept separate from fetchCityRestaurants for the same
 * reason as fetchCityBreakfastPlaces — `restaurant` results aren't dessert
 * venues.
 */
export async function fetchCitySnackPlaces(
  iataCode: string,
  apiKey: string,
  maxCount = 15,
): Promise<RestaurantHint[]> {
  const coords = IATA_COORDS[iataCode];
  if (!coords) return [];

  return searchNearbyHints(coords, apiKey, SNACK_TYPES, 8000, maxCount);
}

export function getIataCoords(iataCode: string): { lat: number; lng: number } | null {
  return IATA_COORDS[iataCode] ?? null;
}

export async function fetchCityAttractions(
  iataCode: string,
  apiKey: string,
  maxCount = 15,
): Promise<RestaurantHint[]> {
  const coords = IATA_COORDS[iataCode];
  if (!coords) return [];

  return searchNearbyHints(coords, apiKey, ["tourist_attraction"], 10000, maxCount);
}

export function buildAttractionHintsPrompt(
  cityEntries: Array<{ cityNameZh: string; attractions: RestaurantHint[] }>,
): string {
  const nonEmpty = cityEntries.filter((e) => e.attractions.length > 0);
  if (nonEmpty.length === 0) return "";

  const sections = nonEmpty.map(({ cityNameZh, attractions }) => {
    const list = attractions
      .map((a) => `${a.name}${a.rating ? `（${a.rating}★）` : ""}`)
      .join("、");
    return `${cityNameZh}：${list}`;
  });

  return `\n\n【已驗證當地景點清單 — 優先使用】\n景點推薦**必須優先從以下清單中選取**，清單均為 Google Maps 真實存在的景點。每個景點在整份行程中只能使用一次，不可重複。若清單中景點數量不足以填滿所有天數，再適量補充其他知名真實景點。\n\n${sections.join("\n\n")}`;
}

export interface PlaceCandidate {
  name: string;
  rating?: number;
  priceLevel?: number | null;
  placeId: string;
  lat: number;
  lng: number;
  address: string;
  photoName?: string | null;
}

/**
 * Nearby place search that keeps real geo data (placeId/lat/lng/address).
 * Used to build real, pickable candidate lists (e.g. day stop suggestions,
 * accommodation candidates).
 */
export async function fetchNearbyPlaceCandidates(
  coords: { lat: number; lng: number },
  apiKey: string,
  types: string[],
  radius: number,
  maxCount = 8,
  priceLevels?: string[],
): Promise<PlaceCandidate[]> {
  try {
    const res = await fetch(NEARBY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.rating,places.location,places.formattedAddress,places.priceLevel,places.photos",
      },
      body: JSON.stringify({
        includedTypes: types,
        maxResultCount: maxCount,
        locationRestriction: {
          circle: {
            center: { latitude: coords.lat, longitude: coords.lng },
            radius,
          },
        },
        rankPreference: "POPULARITY",
        ...(priceLevels ? { priceLevels } : {}),
      }),
    });

    if (!res.ok) {
      console.warn(`[Places API Candidates] HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    return (data.places ?? [])
      .map((p: { id?: string; displayName?: { text?: string }; rating?: number; priceLevel?: string; location?: { latitude?: number; longitude?: number }; formattedAddress?: string; photos?: { name: string }[] }) => ({
        name: p.displayName?.text ?? "",
        rating: p.rating,
        priceLevel: p.priceLevel ? (PRICE_LEVEL_MAP[p.priceLevel] ?? null) : null,
        placeId: p.id ?? "",
        lat: p.location?.latitude ?? 0,
        lng: p.location?.longitude ?? 0,
        address: p.formattedAddress ?? "",
        photoName: p.photos?.[0]?.name ?? null,
      }))
      .filter((c: PlaceCandidate) => c.name.length > 0 && c.placeId.length > 0);
  } catch (err) {
    console.warn(`[Places API Candidates] fetch failed:`, err);
    return [];
  }
}

export interface NearestStation {
  name: string;
  distanceMeters: number;
}

// Typical walkable radius from a hotel to a station; beyond this, "nearest
// station" is more misleading than useful, so treat "none found" as no badge
// rather than surfacing a station that's actually far away.
const STATION_SEARCH_RADIUS_METERS = 1500;

/**
 * Nearest subway/train/light-rail station to a point, with straight-line
 * (haversine) distance — not a walking route, so no extra Routes API call.
 * Returns null if none found within STATION_SEARCH_RADIUS_METERS or on error.
 */
export async function findNearestStation(
  coords: { lat: number; lng: number },
  apiKey: string,
): Promise<NearestStation | null> {
  try {
    const res = await fetch(NEARBY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.location",
      },
      body: JSON.stringify({
        includedTypes: ["subway_station", "train_station", "light_rail_station"],
        maxResultCount: 1,
        rankPreference: "DISTANCE",
        locationRestriction: {
          circle: {
            center: { latitude: coords.lat, longitude: coords.lng },
            radius: STATION_SEARCH_RADIUS_METERS,
          },
        },
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const station = data.places?.[0];
    if (!station?.location || !station.displayName?.text) return null;

    return {
      name: station.displayName.text,
      distanceMeters: Math.round(
        haversineKm(coords.lat, coords.lng, station.location.latitude, station.location.longitude) * 1000
      ),
    };
  } catch {
    return null;
  }
}

function formatHintSections(
  cityEntries: Array<{ cityNameZh: string; places: RestaurantHint[] }>,
): string {
  return cityEntries
    .map(({ cityNameZh, places }) => {
      const list = places
        .map((p) => `${p.name}${p.rating ? `（${p.rating}★）` : ""}`)
        .join("、");
      return `${cityNameZh}：${list}`;
    })
    .join("\n\n");
}

/**
 * Build the restaurant hints section to inject into the system prompt.
 * breakfastPlaces/snackPlaces come from cafe/bakery/ice-cream Place Types and
 * mainMealPlaces from restaurant-family Place Types (see
 * docs/google-places-types.md), so each meal slot is backed by a list that
 * actually matches what it can recommend.
 */
export function buildRestaurantHintsPrompt(
  cityEntries: Array<{
    cityNameZh: string;
    iataCode: string;
    breakfastPlaces: RestaurantHint[];
    mainMealPlaces: RestaurantHint[];
    snackPlaces: RestaurantHint[];
  }>,
  budget?: BudgetLevel,
): string {
  const budgetNote = budget
    ? `（已依「${BUDGET_LABEL[budget]}」預算篩選）`
    : "";

  let prompt = "";

  const breakfastEntries = cityEntries
    .map(({ cityNameZh, breakfastPlaces }) => ({ cityNameZh, places: breakfastPlaces }))
    .filter((e) => e.places.length > 0);
  if (breakfastEntries.length > 0) {
    prompt += `\n\n【已驗證當地早餐地點清單 — 早餐必須優先使用】\n早餐（breakfast）推薦**必須優先從以下清單中選取**，清單均為 Google Maps 真實存在的咖啡館／麵包店。每個地點在整份行程中只能使用一次，不可重複。若清單數量不足以填滿所有天數，再適量補充其他知名真實咖啡館或麵包店（同樣須符合早餐場所限制）。\n\n${formatHintSections(breakfastEntries)}`;
  }

  const mainMealEntries = cityEntries
    .map(({ cityNameZh, mainMealPlaces }) => ({ cityNameZh, places: mainMealPlaces }))
    .filter((e) => e.places.length > 0);
  if (mainMealEntries.length > 0) {
    prompt += `\n\n【已驗證當地餐廳清單${budgetNote} — 午、晚餐必須優先使用】\n午餐、晚餐推薦**必須優先從以下清單中選取**，清單均為 Google Maps 真實存在的餐廳。每家餐廳在整份行程中只能使用一次，不可重複。若行程途經克魯格國家公園等偏遠地區且清單無對應餐廳，才可使用園區內的實際營地餐廳（如 Skukuza Camp Restaurant、Cattle Baron），但同一家仍不得重複使用。\n\n${formatHintSections(mainMealEntries)}`;
  }

  const snackEntries = cityEntries
    .map(({ cityNameZh, snackPlaces }) => ({ cityNameZh, places: snackPlaces }))
    .filter((e) => e.places.length > 0);
  if (snackEntries.length > 0) {
    prompt += `\n\n【已驗證當地點心地點清單 — 點心必須優先使用】\n點心（snack，下午茶／甜點）推薦**必須優先從以下清單中選取**，清單均為 Google Maps 真實存在的咖啡館、甜點店或冰淇淋店。此清單可能與上方【已驗證當地早餐地點清單】出現同一家店，仍須遵守整份行程「同一餐廳/店名只能使用一次」的規則——即使某店同時出現在早餐與點心清單中，也只能在其中一餐使用一次，不可兩餐都選它。若清單數量不足以填滿所有天數，再適量補充其他知名真實甜點店、咖啡館或冰淇淋店。\n\n${formatHintSections(snackEntries)}`;
  }

  return prompt;
}

const NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby";

export type BudgetLevel = "budget" | "moderate" | "luxury";

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

/** Place Types to search for a given meal slot — breakfast uses BREAKFAST_TYPES, lunch/dinner use the budget-aware main-meal types. */
export function getMealPlaceTypes(mealType: "breakfast" | "lunch" | "dinner", budget?: BudgetLevel): string[] {
  return mealType === "breakfast" ? BREAKFAST_TYPES : getMainMealTypes(budget);
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

// City-centre coordinates for IATA codes used in seed scenarios
const IATA_COORDS: Record<string, { lat: number; lng: number }> = {
  // East Asia
  NRT: { lat: 35.6762, lng: 139.6503 },
  HND: { lat: 35.6762, lng: 139.6503 },
  KIX: { lat: 34.6937, lng: 135.5023 },
  ICN: { lat: 37.5665, lng: 126.9780 },
  // Europe
  CDG: { lat: 48.8566, lng: 2.3522 },
  AMS: { lat: 52.3676, lng: 4.9041 },
  VIE: { lat: 48.2082, lng: 16.3738 },
  PRG: { lat: 50.0755, lng: 14.4378 },
  ARN: { lat: 59.3293, lng: 18.0686 },
  CPH: { lat: 55.6761, lng: 12.5683 },
  LHR: { lat: 51.5074, lng: -0.1278 },
  EDI: { lat: 55.9533, lng: -3.1883 },
  // Oceania
  PER: { lat: -31.9505, lng: 115.8605 },
  MEL: { lat: -37.8136, lng: 144.9631 },
  SYD: { lat: -33.8688, lng: 151.2093 },
  // North America
  JFK: { lat: 40.7128, lng: -74.0060 },
  MIA: { lat: 25.7617, lng: -80.1918 },
  LAX: { lat: 34.0522, lng: -118.2437 },
  SFO: { lat: 37.7749, lng: -122.4194 },
  // Africa
  CPT: { lat: -33.9249, lng: 18.4241 },
  JNB: { lat: -26.2041, lng: 28.0473 },
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
  placeId: string;
  lat: number;
  lng: number;
  address: string;
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
        "X-Goog-FieldMask": "places.id,places.displayName,places.rating,places.location,places.formattedAddress",
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
      .map((p: { id?: string; displayName?: { text?: string }; rating?: number; location?: { latitude?: number; longitude?: number }; formattedAddress?: string }) => ({
        name: p.displayName?.text ?? "",
        rating: p.rating,
        placeId: p.id ?? "",
        lat: p.location?.latitude ?? 0,
        lng: p.location?.longitude ?? 0,
        address: p.formattedAddress ?? "",
      }))
      .filter((c: PlaceCandidate) => c.name.length > 0 && c.placeId.length > 0);
  } catch (err) {
    console.warn(`[Places API Candidates] fetch failed:`, err);
    return [];
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
 * breakfastPlaces come from cafe/bakery Place Types and mainMealPlaces from
 * restaurant-family Place Types (see docs/google-places-types.md), so each
 * meal slot is backed by a list that actually matches what it can recommend.
 */
export function buildRestaurantHintsPrompt(
  cityEntries: Array<{
    cityNameZh: string;
    iataCode: string;
    breakfastPlaces: RestaurantHint[];
    mainMealPlaces: RestaurantHint[];
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

  return prompt;
}

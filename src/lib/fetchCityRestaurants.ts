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
 * Fetch top restaurants near a city via Google Places Nearby Search.
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

  const priceLevels = budget ? BUDGET_TO_PRICE_LEVELS[budget] : undefined;

  try {
    const res = await fetch(NEARBY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.rating",
      },
      body: JSON.stringify({
        includedTypes: ["restaurant"],
        maxResultCount: maxCount,
        locationRestriction: {
          circle: {
            center: { latitude: coords.lat, longitude: coords.lng },
            radius: 8000,
          },
        },
        rankPreference: "POPULARITY",
        ...(priceLevels ? { priceLevels } : {}),
      }),
    });

    if (!res.ok) {
      console.warn(`[Places API] ${iataCode} HTTP ${res.status}`);
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
    console.warn(`[Places API] ${iataCode} fetch failed:`, err);
    return [];
  }
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

  try {
    const res = await fetch(NEARBY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.rating",
      },
      body: JSON.stringify({
        includedTypes: ["tourist_attraction"],
        maxResultCount: maxCount,
        locationRestriction: {
          circle: {
            center: { latitude: coords.lat, longitude: coords.lng },
            radius: 10000,
          },
        },
        rankPreference: "POPULARITY",
      }),
    });

    if (!res.ok) {
      console.warn(`[Places API Attractions] ${iataCode} HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    return (data.places ?? [])
      .map((p: { displayName?: { text?: string }; rating?: number }) => ({
        name: p.displayName?.text ?? "",
        rating: p.rating,
      }))
      .filter((a: RestaurantHint) => a.name.length > 0);
  } catch (err) {
    console.warn(`[Places API Attractions] ${iataCode} fetch failed:`, err);
    return [];
  }
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

/**
 * Generic nearby place search by coordinates.
 * Used by regenerate routes to fetch candidates before calling the AI.
 */
export async function fetchNearbyPlaces(
  coords: { lat: number; lng: number },
  apiKey: string,
  types: string[],
  radius: number,
  maxCount = 10,
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
        includedTypes: types,
        maxResultCount: maxCount,
        locationRestriction: {
          circle: {
            center: { latitude: coords.lat, longitude: coords.lng },
            radius,
          },
        },
        rankPreference: "POPULARITY",
      }),
    });

    if (!res.ok) {
      console.warn(`[Places API Nearby] HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    return (data.places ?? [])
      .map((p: { displayName?: { text?: string }; rating?: number }) => ({
        name: p.displayName?.text ?? "",
        rating: p.rating,
      }))
      .filter((h: RestaurantHint) => h.name.length > 0);
  } catch (err) {
    console.warn(`[Places API Nearby] fetch failed:`, err);
    return [];
  }
}

/**
 * Build the restaurant hints section to inject into the system prompt.
 * cityEntries: array of [cityNameZh, iataCode, restaurants]
 */
export function buildRestaurantHintsPrompt(
  cityEntries: Array<{ cityNameZh: string; iataCode: string; restaurants: RestaurantHint[] }>,
  budget?: BudgetLevel,
): string {
  const nonEmpty = cityEntries.filter((e) => e.restaurants.length > 0);
  if (nonEmpty.length === 0) return "";

  const budgetNote = budget
    ? `（已依「${BUDGET_LABEL[budget]}」預算篩選）`
    : "";

  const sections = nonEmpty.map(({ cityNameZh, restaurants }) => {
    const list = restaurants
      .map((r) => `${r.name}${r.rating ? `（${r.rating}★）` : ""}`)
      .join("、");
    return `${cityNameZh}：${list}`;
  });

  return `\n\n【已驗證當地餐廳清單${budgetNote} — 必須優先使用】\n早、午、晚餐推薦**必須優先從以下清單中選取**，清單均為 Google Maps 真實存在的餐廳。每家餐廳在整份行程中只能使用一次，不可重複。若行程途經克魯格國家公園等偏遠地區且清單無對應餐廳，才可使用園區內的實際營地餐廳（如 Skukuza Camp Restaurant、Cattle Baron），但同一家仍不得重複使用。\n\n${sections.join("\n\n")}`;
}

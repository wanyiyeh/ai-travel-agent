import { haversineKm } from "@/lib/distanceMatrix";
import { getIataCoords } from "@/lib/airports";
import { prisma, j } from "@/lib/db";
import { googleFetch } from "@/lib/googleFetch";
import { isBudgetLodging, isLuxuryLodging, rankLodgingByBudget } from "@/lib/lodgingTiers";
import { CAFE_MEAL_TYPES } from "@/lib/cafeMealSlots";
import { NIGHTCAP_TYPES } from "@/lib/drinkPlaces";
import type { MealType } from "@/types/itinerary";

const NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby";

// Google bills a Places request at the tier of its most expensive field
// (plan/form-preference-wiring.md 1c-2; same lesson as September's Text
// Search overspend). Pro: 5,000 free calls/month. Enterprise: 1,000.
// Only lunch/dinner needs Enterprise — its budget ranking reads priceRange.
// Nearby Search has no priceLevels filter (only Text Search does): it was
// silently ignored while still splitting the cache per budget.
// accessibilityOptions is a Pro field too, for 長輩 (plan 1.5): a wheelchair-
// accessible entrance scores a sight up. Pools cached before it was asked for
// lack it until they refresh (30 days).
export const PRO_FIELD_MASK =
  "places.id,places.displayName,places.location,places.formattedAddress,places.photos,places.types,places.accessibilityOptions";
export const ENTERPRISE_FIELD_MASK = `${PRO_FIELD_MASK},places.rating,places.priceLevel,places.priceRange`;
// 親子 only (plan/form-preference-wiring.md 1.5): whether a restaurant suits
// children, an Enterprise + Atmosphere field — the costliest tier, so only
// a trip with children asks, for lunch and dinner, under its own cache key.
export const KIDS_FIELD_MASK = `${ENTERPRISE_FIELD_MASK},places.goodForChildren,places.menuForChildren`;
const maskFor = (tier: FieldTier) =>
  tier === "kids" ? KIDS_FIELD_MASK : tier === "enterprise" ? ENTERPRISE_FIELD_MASK : PRO_FIELD_MASK;
const HINTS_FIELD_MASK = "places.displayName,places.location,places.types";

/** Which field set a candidate search asks for — see PRO_FIELD_MASK. */
export type FieldTier = "pro" | "enterprise" | "kids";

// Shared TTL for every Nearby Search cache in this file (city hint lists,
// candidate pools, nearest-station lookups) — Places results change slowly,
// and this matches the TTL already used for the recommendation caches
// elsewhere in the app (see transit-recommendations/route.ts).
const NEARBY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function getCachedOrFetchHints(
  iataCode: string,
  kind: string,
  budget: string,
  fetcher: () => Promise<RestaurantHint[]>,
): Promise<RestaurantHint[]> {
  const where = { iataCode_kind_budget: { iataCode, kind, budget } };

  const cached = await prisma.cityPlaceHintsCache.findUnique({ where });
  if (cached && Date.now() - cached.updatedAt.getTime() < NEARBY_CACHE_TTL_MS) {
    return JSON.parse(cached.hints) as RestaurantHint[];
  }

  const hints = await fetcher();
  // Don't cache an empty result (e.g. a transient API error) — let the next
  // call retry instead of pinning "no hints" for 30 days.
  if (hints.length > 0) {
    await prisma.cityPlaceHintsCache.upsert({
      where,
      create: { iataCode, kind, budget, hints: j(hints) },
      update: { hints: j(hints) },
    });
  }
  return hints;
}

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
  // Added for the scheduler rule engine (plan/hybrid-rule-engine-scheduling.md
  // Phase 3) to consume these hints as StopCandidates — lat/lng is required by
  // buildDaySkeleton, types feeds mapPlaceTypeToCategory for duration estimates.
  // Optional since existing CityPlaceHintsCache rows written before this change
  // won't have them until their 30-day TTL naturally refreshes; prompt-building
  // code here only ever reads name/rating and ignores these.
  lat?: number;
  lng?: number;
  types?: string[];
}

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

/**
 * Place Types to search for a given meal slot — breakfast and snack share one
 * café search (CAFE_MEAL_TYPES, split locally by cafeMealSlots.ts), lunch/
 * dinner use the budget-aware main-meal types. BREAKFAST_TYPES/SNACK_TYPES
 * above are only for the old full-LLM flow's prompt hints.
 */
export function getMealPlaceTypes(mealType: MealType, budget?: BudgetLevel): string[] {
  if (mealType === "breakfast" || mealType === "snack") return CAFE_MEAL_TYPES;
  if (mealType === "nightcap") return NIGHTCAP_TYPES;
  return getMainMealTypes(budget);
}

// Table A lodging subtypes (see docs/google-places-types.md), picked per budget
// so a "budget" trip surfaces hostels/guest houses instead of resort hotels.
// The tier itself (hostels only, no luxury brands, brand hotels only) comes
// from rankLodgingByBudget in fetchLodgingCandidates — these lists only
// decide what's in the pool. Moderate: B&Bs, guest houses, ~3-star and business
// hotels (Toyoko Inn-style chains are typed "hotel").
const LODGING_TYPES_BY_BUDGET: Record<BudgetLevel, string[]> = {
  // No generic "lodging": ranked by popularity, it filled all 20 Asakusa
  // results with chain hotels and left no hostel or guest house in the pool.
  budget:   ["hostel", "guest_house", "bed_and_breakfast", "budget_japanese_inn", "motel"],
  moderate: ["bed_and_breakfast", "guest_house", "hotel", "lodging"],
  luxury:   ["resort_hotel", "hotel", "lodging"],
};

export function getLodgingTypes(budget?: BudgetLevel): string[] {
  return budget ? LODGING_TYPES_BY_BUDGET[budget] : ["hotel", "resort_hotel", "guest_house", "lodging"];
}


/**
 * Nearby Search restricted to a set of Table A place types, returning just
 * name hints. Shared by the restaurant/breakfast/attraction fetchers below —
 * they differ only in which types and radius they pass. Pro fields only (no
 * rating), so it bills at the Pro tier — see PRO_FIELD_MASK. Returns empty
 * array on any error so callers can gracefully degrade.
 */
async function searchNearbyHints(
  coords: { lat: number; lng: number },
  apiKey: string,
  includedTypes: string[],
  radius: number,
  maxCount: number,
): Promise<RestaurantHint[]> {
  try {
    const res = await googleFetch(NEARBY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": HINTS_FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes,
        maxResultCount: maxCount,
        languageCode: "zh-TW",
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
      console.warn(`[Places API] ${includedTypes.join(",")} HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    return (data.places ?? [])
      .map((p: { displayName?: { text?: string }; rating?: number; location?: { latitude?: number; longitude?: number }; types?: string[] }) => ({
        name: cleanPlaceName(p.displayName?.text ?? ""),
        rating: p.rating,
        lat: p.location?.latitude,
        lng: p.location?.longitude,
        types: p.types,
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
  const coords = getIataCoords(iataCode);
  if (!coords) return [];

  return getCachedOrFetchHints(iataCode, "mainMeal", budget ?? "", () =>
    searchNearbyHints(coords, apiKey, getMainMealTypes(budget), 8000, maxCount)
  );
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
  const coords = getIataCoords(iataCode);
  if (!coords) return [];

  return getCachedOrFetchHints(iataCode, "breakfast", "", () =>
    searchNearbyHints(coords, apiKey, BREAKFAST_TYPES, 8000, maxCount)
  );
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
  const coords = getIataCoords(iataCode);
  if (!coords) return [];

  return getCachedOrFetchHints(iataCode, "snack", "", () =>
    searchNearbyHints(coords, apiKey, SNACK_TYPES, 8000, maxCount)
  );
}

// Re-exported for existing importers (itineraryGen.ts, accommodation/regenerate
// route) — the table itself now lives in src/lib/airports.ts.
export { getIataCoords };

export async function fetchCityAttractions(
  iataCode: string,
  apiKey: string,
  maxCount = 15,
): Promise<RestaurantHint[]> {
  const coords = getIataCoords(iataCode);
  if (!coords) return [];

  return getCachedOrFetchHints(iataCode, "attraction", "", () =>
    searchNearbyHints(coords, apiKey, ["tourist_attraction"], 10000, maxCount)
  );
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
  /** Enterprise-tier field — absent on Pro searches. */
  rating?: number;
  /** Enterprise-tier field — absent on Pro searches. */
  priceLevel?: number | null;
  /**
   * Per-person price range in local currency (Google Maps' "$1-200"), from
   * Enterprise searches only. `end` unset means open-ended ("$2,000+").
   */
  priceRange?: PriceRange | null;
  placeId: string;
  lat: number;
  lng: number;
  address: string;
  photoName?: string | null;
  // Added for the scheduler rule engine (plan/hybrid-rule-engine-scheduling.md
  // Phase 3) — mapPlaceTypeToCategory feeds this into duration estimates, same
  // reasoning as RestaurantHint.types. Optional since existing
  // NearbyPlaceCandidatesCache rows (30-day TTL) won't have it until they
  // naturally refresh; every other existing caller here only ever reads the
  // fields above and ignores this one.
  types?: string[];
  /** Kids tier only (KIDS_FIELD_MASK); absent when Google doesn't say. */
  goodForChildren?: boolean;
  menuForChildren?: boolean;
  /** A wheelchair-accessible entrance; absent when Google doesn't say, or the pool predates the field. */
  accessibleEntrance?: boolean;
}

export type PriceRange = { currency: string; start?: number; end?: number };

type GoogleMoney = { currencyCode?: string; units?: string; nanos?: number };

function moneyAmount(m: GoogleMoney | undefined): number | undefined {
  if (!m || m.units == null) return undefined;
  return Number(m.units) + (m.nanos ?? 0) / 1e9;
}

function parsePriceRange(raw: { startPrice?: GoogleMoney; endPrice?: GoogleMoney } | undefined): PriceRange | null {
  const currency = raw?.startPrice?.currencyCode ?? raw?.endPrice?.currencyCode;
  if (!raw || !currency) return null;
  return { currency, start: moneyAmount(raw.startPrice), end: moneyAmount(raw.endPrice) };
}

// ~11m precision — coarse enough that a stop's stored lat/lng always rounds
// the same way across requests, without collapsing genuinely distinct anchors.
function roundCoord(n: number): string {
  return n.toFixed(4);
}

// The trailing empty slot used to hold the request's priceLevels; it's kept
// empty (rather than dropped) so pools cached before the filter was removed
// still match. Pro pools add a ":pro" suffix since they lack Enterprise
// fields an Enterprise caller would need.
function buildCandidatesCacheKey(
  coords: { lat: number; lng: number },
  types: string[],
  radius: number,
  maxCount: number,
  tier: FieldTier,
  match: TypeMatch = "any",
): string {
  const sortedTypes = [...types].sort().join(",");
  const base = `${roundCoord(coords.lat)},${roundCoord(coords.lng)}:${radius}:${maxCount}:${sortedTypes}:`;
  const tiered = tier === "pro" ? `${base}:pro` : tier === "kids" ? `${base}:kids` : base;
  return match === "primary" ? `${tiered}:primary` : tiered;
}

/**
 * How Nearby Search matches `types`: "any" (includedTypes) takes a place
 * that lists one of them anywhere, "primary" (includedPrimaryTypes) only a
 * place whose main type is one. A bar search by "any" came back with 2 bars
 * in 20 — the rest were famous places that merely have a bar (a mall,
 * nightclubs, hotels, a burger chain).
 */
export type TypeMatch = "any" | "primary";

// Nearby Search bills per request, not per result, so every call fetches
// Google's max and slices locally. Callers asking for different counts
// (e.g. the departure day's few stops vs a sightseeing block's full pool)
// then share one cached pool per coords/types/radius instead of each
// paying for its own.
const NEARBY_FETCH_COUNT = 20;

async function readFreshCandidates(cacheKey: string): Promise<PlaceCandidate[] | null> {
  const cached = await prisma.nearbyPlaceCandidatesCache.findUnique({ where: { cacheKey } });
  if (!cached || Date.now() - cached.updatedAt.getTime() >= NEARBY_CACHE_TTL_MS) return null;
  return (JSON.parse(cached.candidates) as PlaceCandidate[]).map((p) => ({ ...p, name: cleanPlaceName(p.name) }));
}

// Some businesses put an ad in their Google name: 「花蓮將軍府1936(免預約入園，
// 加LINE官方好友享優惠)」, 「又一村文創（各店家詳細營業時間請見粉專）」.
const PROMO_IN_BRACKETS = /\s*[(（][^()（）]*(優惠|LINE|預約|營業時間|粉專|官方|折扣|免費)[^()（）]*[)）]/gi;

// Others stuff it with search keywords: 「烏龜島咖啡甜點伴手禮|宜蘭名產|採現場後位…」.
// One bar can be a branch (「店名 | 信義店」), so only two or more count.
const KEYWORD_BARS = /[|｜]/g;
const KEYWORDS_START = /\s*[|｜《]/;

/** A place's name without an advertisement in brackets or a list of keywords. */
export function cleanPlaceName(name: string): string {
  const unstuffed = (name.match(KEYWORD_BARS)?.length ?? 0) >= 2 ? name.split(KEYWORDS_START)[0] : name;
  const cleaned = unstuffed.replace(PROMO_IN_BRACKETS, "").trim();
  return cleaned || name;
}

/**
 * Nearby place search that keeps real geo data (placeId/lat/lng/address).
 * Used to build real, pickable candidate lists (e.g. day stop suggestions,
 * accommodation candidates). `tier` picks the field set and so the billing
 * tier — "pro" unless the caller genuinely needs rating/price data.
 */
export async function fetchNearbyPlaceCandidates(
  coords: { lat: number; lng: number },
  apiKey: string,
  types: string[],
  radius: number,
  maxCount = 8,
  tier: FieldTier = "pro",
  match: TypeMatch = "any",
): Promise<PlaceCandidate[]> {
  // Key keeps the maxCount slot (fixed at NEARBY_FETCH_COUNT) so rows
  // already cached by maxCount=20 callers stay valid.
  const cacheKey = buildCandidatesCacheKey(coords, types, radius, NEARBY_FETCH_COUNT, tier, match);
  // An Enterprise pool has every Pro field too, so a Pro caller can reuse one
  // rather than paying again for the same places.
  const cached =
    (await readFreshCandidates(cacheKey)) ??
    (tier === "pro"
      ? await readFreshCandidates(buildCandidatesCacheKey(coords, types, radius, NEARBY_FETCH_COUNT, "enterprise", match))
      : null);
  if (cached) return cached.slice(0, maxCount);

  const candidates = await fetchNearbyPlaceCandidatesUncached(coords, apiKey, types, radius, NEARBY_FETCH_COUNT, tier, match);
  // Don't cache an empty pool — could be a transient API failure rather than
  // a genuinely sparse area, so let the next call retry instead of pinning it.
  if (candidates.length > 0) {
    await prisma.nearbyPlaceCandidatesCache.upsert({
      where: { cacheKey },
      create: { cacheKey, candidates: j(candidates) },
      update: { candidates: j(candidates) },
    });
  }
  return candidates.slice(0, maxCount);
}

type NearbyPlaceResult = {
  id?: string;
  displayName?: { text?: string };
  rating?: number;
  priceLevel?: string;
  priceRange?: { startPrice?: GoogleMoney; endPrice?: GoogleMoney };
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  photos?: { name: string }[];
  types?: string[];
  goodForChildren?: boolean;
  menuForChildren?: boolean;
  accessibilityOptions?: { wheelchairAccessibleEntrance?: boolean };
};

async function fetchNearbyPlaceCandidatesUncached(
  coords: { lat: number; lng: number },
  apiKey: string,
  types: string[],
  radius: number,
  maxCount: number,
  tier: FieldTier,
  match: TypeMatch,
): Promise<PlaceCandidate[]> {
  try {
    const res = await googleFetch(NEARBY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": maskFor(tier),
      },
      body: JSON.stringify({
        ...(match === "primary" ? { includedPrimaryTypes: types } : { includedTypes: types }),
        maxResultCount: maxCount,
        languageCode: "zh-TW",
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
      console.warn(`[Places API Candidates] HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    return (data.places ?? [])
      .map((p: NearbyPlaceResult) => ({
        name: cleanPlaceName(p.displayName?.text ?? ""),
        rating: p.rating,
        priceLevel: p.priceLevel ? (PRICE_LEVEL_MAP[p.priceLevel] ?? null) : null,
        priceRange: parsePriceRange(p.priceRange),
        placeId: p.id ?? "",
        lat: p.location?.latitude ?? 0,
        lng: p.location?.longitude ?? 0,
        address: p.formattedAddress ?? "",
        photoName: p.photos?.[0]?.name ?? null,
        types: p.types,
        ...(p.goodForChildren !== undefined ? { goodForChildren: p.goodForChildren } : {}),
        ...(p.menuForChildren !== undefined ? { menuForChildren: p.menuForChildren } : {}),
        ...(p.accessibilityOptions?.wheelchairAccessibleEntrance !== undefined
          ? { accessibleEntrance: p.accessibilityOptions.wheelchairAccessibleEntrance }
          : {}),
      }))
      .filter((c: PlaceCandidate) => c.name.length > 0 && c.placeId.length > 0);
  } catch (err) {
    console.warn(`[Places API Candidates] fetch failed:`, err);
    return [];
  }
}

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const MAX_TEXT_BIAS_RADIUS_M = 50000;

/**
 * Text Search returning a whole candidate list — placesTextSearch.ts only
 * ever keeps the single best match. For what Nearby Search can't express: a
 * place kind with no type ("luxury hotel"), or a price filter — unlike Nearby
 * Search, Text Search applies `priceLevels` server-side. Pro fields unless
 * `tier: "enterprise"` (needed to read prices back). Cached for 30 days in
 * the same table as Nearby pools under a "text:" key.
 */
export async function searchTextCandidates(
  query: string,
  coords: { lat: number; lng: number },
  apiKey: string,
  radius: number,
  includedType?: string,
  { tier = "pro", priceLevels, minRating }: { tier?: FieldTier; priceLevels?: string[]; minRating?: number } = {},
): Promise<PlaceCandidate[]> {
  const priceKey = priceLevels ? [...priceLevels].sort().join(",") : "";
  const ratingKey = minRating !== undefined ? `:r${minRating}` : "";
  const cacheKey = `text:${query}@${roundCoord(coords.lat)},${roundCoord(coords.lng)}:${radius}:${includedType ?? ""}:${priceKey}:${tier}${ratingKey}`;
  const cached = await readFreshCandidates(cacheKey);
  if (cached) return cached;

  let candidates: PlaceCandidate[] = [];
  try {
    const res = await googleFetch(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": maskFor(tier),
      },
      body: JSON.stringify({
        textQuery: query,
        pageSize: NEARBY_FETCH_COUNT,
        languageCode: "zh-TW",
        // Google rejects a bias circle over 50km with a 400 (a car-rental search
        // at 80km came back empty that way).
        locationBias: {
          circle: { center: { latitude: coords.lat, longitude: coords.lng }, radius: Math.min(radius, MAX_TEXT_BIAS_RADIUS_M) },
        },
        ...(includedType ? { includedType } : {}),
        ...(priceLevels ? { priceLevels } : {}),
        // Filtered by Google, so it needs no rating field (stays Pro).
        ...(minRating !== undefined ? { minRating } : {}),
      }),
    });
    if (!res.ok) {
      console.warn(`[Places API Text Candidates] HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    candidates = (data.places ?? [])
      .map((p: NearbyPlaceResult) => ({
        name: cleanPlaceName(p.displayName?.text ?? ""),
        rating: p.rating,
        priceLevel: p.priceLevel ? (PRICE_LEVEL_MAP[p.priceLevel] ?? null) : null,
        priceRange: parsePriceRange(p.priceRange),
        placeId: p.id ?? "",
        lat: p.location?.latitude ?? 0,
        lng: p.location?.longitude ?? 0,
        address: p.formattedAddress ?? "",
        photoName: p.photos?.[0]?.name ?? null,
        types: p.types,
      }))
      .filter((c: PlaceCandidate) => c.name.length > 0 && c.placeId.length > 0);
  } catch (err) {
    console.warn(`[Places API Text Candidates] fetch failed:`, err);
    return [];
  }

  // Every failed request returned above, so an empty list here is a
  // confirmed "found nothing" (no matcha café in a small town) — cached too,
  // or each trip there would pay for the same empty search again.
  await prisma.nearbyPlaceCandidatesCache.upsert({
    where: { cacheKey },
    create: { cacheKey, candidates: j(candidates) },
    update: { candidates: j(candidates) },
  });
  return candidates;
}

// Below this many budget-tier places, a budget search also brings in regular lodging.
const MIN_BUDGET_LODGING = 3;

// Expensive and very expensive by Google's own price level.
const LUXURY_PRICE_LEVELS = ["PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"];

/**
 * Lunch/dinner candidates a luxury trip should see first. The regular
 * "restaurant" Nearby pool is ranked by popularity, so it's mostly ramen and
 * curry (an eval run of a luxury Tokyo trip had 0% of meals in the
 * NT$1,000–2,000 range); ranking can't surface places that aren't in it.
 * Text Search filters by price level server-side, and Enterprise fields bring
 * back the price range used for budget ranking. One call per city, only for
 * the luxury tier.
 */
export function fetchLuxuryRestaurants(
  coords: { lat: number; lng: number },
  apiKey: string,
  radius: number,
): Promise<PlaceCandidate[]> {
  return searchTextCandidates("restaurant", coords, apiKey, radius, "restaurant", {
    tier: "enterprise",
    priceLevels: LUXURY_PRICE_LEVELS,
  });
}

/**
 * Lodging candidates for a budget tier (plan/form-preference-wiring.md 1.3),
 * shared by itinerary generation and the 換一間 picker. One Pro-tier Nearby
 * search, narrowed to the budget tier locally (rankLodgingByBudget). Luxury only: if the pool has
 * no brand hotel or resort at all, adds a "luxury hotel" Text Search so a
 * city without the big chains still gets its high-end options.
 */
export async function fetchLodgingCandidates(
  coords: { lat: number; lng: number },
  apiKey: string,
  budget: BudgetLevel | undefined,
  radius: number,
  maxCount: number,
): Promise<PlaceCandidate[]> {
  let pool = await fetchNearbyPlaceCandidates(coords, apiKey, getLodgingTypes(budget), radius, NEARBY_FETCH_COUNT);
  // A small town may have too few budget places to choose from — then add
  // regular lodging after them rather than offering almost nothing.
  if (budget === "budget" && pool.filter(isBudgetLodging).length < MIN_BUDGET_LODGING) {
    const extra = await fetchNearbyPlaceCandidates(coords, apiKey, ["lodging"], radius, NEARBY_FETCH_COUNT);
    const seen = new Set(pool.map((p) => p.placeId));
    pool = [...pool, ...extra.filter((p) => !seen.has(p.placeId))];
  }
  if (budget === "luxury" && !pool.some(isLuxuryLodging)) {
    const extra = await searchTextCandidates("luxury hotel", coords, apiKey, radius, "lodging");
    const seen = new Set(pool.map((p) => p.placeId));
    pool = [...extra.filter((p) => !seen.has(p.placeId)), ...pool];
  }
  return rankLodgingByBudget(pool, budget).slice(0, maxCount);
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
  const cacheKey = `${roundCoord(coords.lat)},${roundCoord(coords.lng)}`;
  const cached = await prisma.nearestStationCache.findUnique({ where: { cacheKey } });
  if (cached && Date.now() - cached.updatedAt.getTime() < NEARBY_CACHE_TTL_MS) {
    return cached.station ? (JSON.parse(cached.station) as NearestStation) : null;
  }

  // ok distinguishes "the API call succeeded (found a station, or confirmed
  // none nearby)" from a network/HTTP failure — only the former is cached, so
  // a transient outage retries next time instead of pinning "no station" for
  // STATION cache TTL.
  const { ok, station } = await findNearestStationUncached(coords, apiKey);
  if (ok) {
    await prisma.nearestStationCache.upsert({
      where: { cacheKey },
      create: { cacheKey, station: station ? j(station) : null },
      update: { station: station ? j(station) : null },
    });
  }
  return station;
}

async function findNearestStationUncached(
  coords: { lat: number; lng: number },
  apiKey: string,
): Promise<{ ok: boolean; station: NearestStation | null }> {
  try {
    const res = await googleFetch(NEARBY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.location",
      },
      body: JSON.stringify({
        includedTypes: ["subway_station", "train_station", "light_rail_station"],
        maxResultCount: 1,
        languageCode: "zh-TW",
        rankPreference: "DISTANCE",
        locationRestriction: {
          circle: {
            center: { latitude: coords.lat, longitude: coords.lng },
            radius: STATION_SEARCH_RADIUS_METERS,
          },
        },
      }),
    });

    if (!res.ok) return { ok: false, station: null };

    const data = await res.json();
    const station = data.places?.[0];
    if (!station?.location || !station.displayName?.text) return { ok: true, station: null };

    return {
      ok: true,
      station: {
        name: station.displayName.text,
        distanceMeters: Math.round(
          haversineKm(coords.lat, coords.lng, station.location.latitude, station.location.longitude) * 1000
        ),
      },
    };
  } catch {
    return { ok: false, station: null };
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

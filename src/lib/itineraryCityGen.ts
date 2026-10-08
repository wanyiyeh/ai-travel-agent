import { openai } from "@/lib/openai";
import { getCityCenter } from "@/lib/placesTextSearch";
import { fetchNearbyPlaceCandidates, fetchLodgingCandidates, fetchLuxuryRestaurants, getMealPlaceTypes, type RestaurantHint, type BudgetLevel, type PlaceCandidate, type FieldTier } from "@/lib/fetchCityRestaurants";
import {
  applyAccommodationPick,
  applyMealPicks,
  formatCandidateLists,
  hasAnyCandidates,
  newPickHistory,
  unusedFirst,
  type MealLodgingPools,
} from "@/lib/mealLodgingPicks";
import { placeCandidatesToStopCandidates } from "@/lib/scheduler/placeCandidatesToStopCandidates";
import { distributeStopsPerDay, partitionCandidatesByDay } from "@/lib/scheduler/partitionCandidatesByDay";
import { buildDaySkeleton, type SkeletonStop } from "@/lib/scheduler/buildDaySkeleton";
import { computeDepartureDayBudget } from "@/lib/scheduler/departureDayBudget";
import { estimateStopCapacity } from "@/lib/scheduler/stopCapacity";
import { generateSkeletonCopy } from "@/lib/skeletonCopy";
import { NEUTRAL_PREFERENCE_INTENT, type PreferenceIntent } from "@/lib/schemas";
import { getDistancesForStopPairs, pickModeForDistance, describeTransport } from "@/lib/distanceMatrix";
import { estimateAttractionCost } from "@/lib/priceLevelCost";
import { isFoodPlace } from "@/lib/foodPlace";
import { getTwdRates } from "@/lib/exchangeRate";
import { rankMainMealsByBudget } from "@/lib/mealBudget";
import { fitsMainMeal, splitCafePool } from "@/lib/cafeMealSlots";
import { stayAreaFor } from "@/lib/stayAreas";
import { THEMES, dayThemeKeys, interestWeightsOf, isOnTheme, popularSlots, themesOf, type ThemeKey } from "@/lib/dayThemes";
import { dietPromptLine, dietRequiredTypes, excludeByDiet } from "@/lib/dietaryFilter";

// Shared AI-generation helpers for building out a city's worth of itinerary
// content (transit day, sightseeing days, accommodation + meals). Used by the
// restructure endpoint to generate new-city content without duplicating
// these prompts.

// Falls back to this pure-LLM implementation whenever the rule-engine path
// (generateTransitDayStopsViaScheduler, below) can't produce a real arrival-
// city candidate pool (see plan/hybrid-rule-engine-scheduling.md Phase 4).
async function generateTransitDayStopsWithLLM(
  fromCity: string,
  toCity: string,
  currency: string
): Promise<Array<Record<string, unknown>>> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `你是專業的旅遊規劃專家。請為旅行者規劃一個從 ${fromCity || "出發地"} 前往 ${toCity} 的移動日行程。

【重要】請先評估兩城市之間的實際地理距離與交通時間，再規劃行程（涵蓋各大洲的城市對，依實際距離判斷，不要只套用單一地區的直覺）：
- 短程（車程＜90 分鐘，如大阪→京都 30min、東京→橫濱 30min、布拉格→布拉迪斯拉發 1hr）：抵達後幾乎是一整個白天都空著，務必安排 2-4 個抵達城市的真實熱門景點填滿下午（甚至傍晚），不可只寫「入住/晚餐」帶過
- 中程（車程 90 分鐘－4 小時，如維也納→布達佩斯 2.5hr、大阪→廣島 1.5hr）：抵達後仍有半天，安排 1-2 個抵達城市的真實景點；若抵達已近傍晚則僅安排晚餐
- 長程（車程＞4 小時或需過夜，如布達佩斯→捷克克魯姆洛夫 8-11hr）：交通佔全天，抵達已是傍晚甚至深夜，不安排觀光，只需 Check-in 或附近晚餐

抵達時間必須用「出發時間＋交通 stop 的 duration_minutes」實際推算，不可憑感覺寫「已是下午/晚上」——如果推算出抵達時間是上午或中午，就必須安排下午的真實景點，不能用长程模板的措辭。

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "stops": [
    {
      "name": "景點或活動名稱（繁體中文）",
      "description": "描述（繁體中文，1-2 句話）",
      "duration_minutes": 60,
      "time_of_day": "morning",
      "transport_from_prev": "步行約 10 分鐘",
      "estimated_cost": 0
    }
  ]
}

規則：
- 依序為：
  1. ${fromCity ? `${fromCity} 出發前早晨微行程（車站附近早餐或快速景點，09:30 前完成，time_of_day: "morning"）` : `出發準備（time_of_day: "morning"）`}
  2. 交通本身（須填入真實交通工具、實際出發/抵達時間、正確車程時數，duration_minutes 必須反映真實車程）
  3. 抵達後活動（依上方短/中/長程規則決定要安排幾個真實景點，短程至少 2 個，中程 1-2 個，長程 1 個 check-in/晚餐）
- 除了短程規則要求的多個景點外，總 stop 數不設死上限，依實際可安排內容決定
- time_of_day 只能是 "morning"、"afternoon"、"evening" 之一
- duration_minutes 為整數（分鐘），交通 stop 必須填入真實車程分鐘數
- transport_from_prev 必須包含預估時間，例如「步行約 10 分鐘」、「搭乘計程車約 15 分鐘」，不可只寫交通方式（如「步行」、「火車」）
- estimated_cost 為 ${currency} 整數，免費填 0
- 所有地點必須真實存在`,
      },
      {
        role: "user",
        content: `請規劃從 ${fromCity || "出發地"} 前往 ${toCity} 的移動日行程。`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0].message.content;
  if (!content) return [];
  const parsed = JSON.parse(content) as { stops?: unknown[] };
  if (!Array.isArray(parsed.stops)) return [];
  return parsed.stops.map((s) => ({
    ...(s as Record<string, unknown>),
    id: crypto.randomUUID(),
  }));
}

type TransitPlan = {
  prepStops: Array<Record<string, unknown>>;
  transitStop: Record<string, unknown>;
  arrivalMinute: number;
};

const DEFAULT_ARRIVAL_MINUTE = 14 * 60;

// Shared by planTransitDay's arrivalTime and generateDepartureDayStops'
// returnDepartureTime — both parse the same "HH:MM" shape the LLM/FlightInfo
// give, just with different fallback defaults.
export function parseTimeString(raw: unknown, fallbackMinute: number): number {
  if (typeof raw !== "string") return fallbackMinute;
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallbackMinute;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallbackMinute;
  return hour * 60 + minute;
}

/**
 * Narrower LLM call for a transit day: keeps the real-world-knowledge parts
 * an LLM is actually needed for (inter-city distance/mode judgment — no
 * rule-engine data source covers flights/trains across countries, unlike the
 * short intra-day hops distanceMatrix.ts handles) but stops asking it to
 * invent named arrival-city attractions. Returns null on any parse failure
 * so the caller falls back to the full pure-LLM implementation.
 */
async function planTransitDay(
  fromCity: string,
  toCity: string,
  currency: string,
  model: string
): Promise<TransitPlan | null> {
  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `你是專業的旅遊規劃專家。請為旅行者規劃一個從 ${fromCity || "出發地"} 前往 ${toCity} 的移動日行程裡「出發準備」與「交通本身」的部分，並推算抵達時間。

【重要】請先評估兩城市之間的實際地理距離與交通時間（涵蓋各大洲的城市對，依實際距離判斷，不要只套用單一地區的直覺）：
- 短程（車程＜90 分鐘，如大阪→京都 30min、東京→橫濱 30min、布拉格→布拉迪斯拉發 1hr）
- 中程（車程 90 分鐘－4 小時，如維也納→布達佩斯 2.5hr、大阪→廣島 1.5hr）
- 長程（車程＞4 小時或需過夜，如布達佩斯→捷克克魯姆洛夫 8-11hr）

抵達時間（arrivalTime）必須用「出發時間＋交通時長」實際推算，不可憑感覺。

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "prepStops": [
    {
      "name": "活動名稱（繁體中文）",
      "description": "描述（繁體中文，1-2 句話）",
      "duration_minutes": 30,
      "time_of_day": "morning",
      "transport_from_prev": "步行約 10 分鐘",
      "estimated_cost": 0
    }
  ],
  "transitStop": {
    "name": "交通方式名稱（例如「搭乘新幹線前往京都」）",
    "description": "描述（繁體中文，1-2 句話）",
    "duration_minutes": 90,
    "time_of_day": "morning",
    "transport_from_prev": "搭乘新幹線約 1 小時30分",
    "estimated_cost": 0
  },
  "arrivalTime": "14:30"
}

規則：
- prepStops：${fromCity ? `${fromCity} 出發前早晨微行程（車站附近早餐或快速景點，09:30 前完成），可以是空陣列` : `出發準備，可以是空陣列`}
- transitStop：交通本身，須填入真實交通工具、正確車程時數，duration_minutes 必須反映真實車程，transport_from_prev 必須包含預估時間（例如「搭乘新幹線約 1 小時30分」），不可只寫交通方式
- arrivalTime："HH:MM" 格式的 24 小時制時間，代表抵達 ${toCity} 後可以開始活動的時間
- time_of_day 只能是 "morning"、"afternoon"、"evening" 之一
- estimated_cost 為 ${currency} 整數，免費填 0`,
        },
        {
          role: "user",
          content: `請規劃從 ${fromCity || "出發地"} 前往 ${toCity} 的移動日「出發準備」與「交通」部分，並推算抵達時間。`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const content = completion.choices[0].message.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as {
      prepStops?: unknown[];
      transitStop?: Record<string, unknown>;
      arrivalTime?: unknown;
    };
    if (!parsed.transitStop || typeof parsed.transitStop !== "object") return null;

    return {
      prepStops: Array.isArray(parsed.prepStops)
        ? parsed.prepStops.map((s) => ({ ...(s as Record<string, unknown>), id: crypto.randomUUID() }))
        : [],
      transitStop: { ...parsed.transitStop, id: crypto.randomUUID() },
      arrivalMinute: parseTimeString(parsed.arrivalTime, DEFAULT_ARRIVAL_MINUTE),
    };
  } catch (err) {
    console.warn("[planTransitDay] falling back to LLM:", err);
    return null;
  }
}

/**
 * Rule-engine path for generateTransitDayStops (plan/hybrid-rule-engine-scheduling.md
 * Phase 4): keeps the LLM's distance/transport-mode judgment (planTransitDay,
 * above) but replaces its invented arrival-city attractions with a real
 * candidate pool run through the same buildDaySkeleton/generateSkeletonCopy
 * pipeline as generateDayStopsViaScheduler. Returns null on any failure (LLM
 * parse failure, no city center, no candidates) so the caller falls back to
 * the full pure-LLM implementation for this transit day.
 */
async function generateTransitDayStopsViaScheduler(
  fromCity: string,
  toCity: string,
  currency: string,
  budget: BudgetLevel | undefined,
  preferenceIntent: PreferenceIntent,
  lockedPlaceIds: string[]
): Promise<Array<Record<string, unknown>> | null> {
  try {
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const plan = await planTransitDay(fromCity, toCity, currency, model);
    if (!plan) return null;

    // How many arrival-city stops fit is clock arithmetic from the arrival
    // time, same as a sightseeing day — not a count the LLM guesses. Checked
    // with no candidate types first so a late arrival skips the Places call.
    const pace = preferenceIntent.pace ?? "moderate";
    const capacityFor = (candidateTypes: (string | undefined)[]) =>
      estimateStopCapacity({
        pace,
        dayStartMinute: plan.arrivalMinute,
        dayEndMinute: SIGHTSEEING_DAY_END_MINUTE,
        candidateTypes,
      });
    if (capacityFor([]) === 0) {
      return [...plan.prepStops, plan.transitStop];
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY!;
    const coords = await getCityCenter(toCity, apiKey);
    if (!coords) return null;

    const places = await fetchNearbyPlaceCandidates(coords, apiKey, ["tourist_attraction"], 10000, 20);
    if (places.length === 0) return null;

    const lockedIds = new Set(lockedPlaceIds);
    const pool = await withSupplementalAttractions(
      coords,
      apiKey,
      places.filter((p) => !lockedIds.has(p.placeId)),
      lockedIds,
      capacityFor([])
    );
    const { candidates, candidateById } = placeCandidatesToStopCandidates(pool);
    if (candidates.length === 0) return null;

    const hintById = new Map<string, RestaurantHint>();
    for (const [id, place] of candidateById) {
      hintById.set(id, { name: place.name, rating: place.rating, lat: place.lat, lng: place.lng, types: place.types });
    }

    const interestWeights = interestWeightsOf(preferenceIntent.interestBoost);
    const skeleton = withinDayEnd(
      buildDaySkeleton(candidates, {
        count: capacityFor(candidates.map((c) => c.type)),
        pace,
        dayStartMinute: plan.arrivalMinute,
        dayEndMinute: SIGHTSEEING_DAY_END_MINUTE,
        interestWeights,
        // The lodging isn't picked yet when the transit day is planned (it
        // runs alongside meal/lodging generation), so score from the center.
        anchor: coords,
        origin: coords,
      }),
      SIGHTSEEING_DAY_END_MINUTE
    );

    const [copy, distances] = await Promise.all([
      generateSkeletonCopy(skeleton, hintById, preferenceIntent, model, toCity),
      getDistancesForStopPairs(
        skeleton.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng })),
        pickModeForDistance
      ),
    ]);

    const arrivalStops = assembleScheduledStops(skeleton, candidateById, copy, distances, currency);
    return [...plan.prepStops, plan.transitStop, ...arrivalStops];
  } catch (err) {
    console.warn("[generateTransitDayStopsViaScheduler] falling back to LLM:", err);
    return null;
  }
}

export async function generateTransitDayStops(
  fromCity: string,
  toCity: string,
  currency: string,
  budget?: BudgetLevel,
  preferenceIntent: PreferenceIntent = NEUTRAL_PREFERENCE_INTENT,
  // Places already used in toCity this trip — a round-trip loop arrives back
  // in a city it already visited (札幌 → 函館 → 札幌), and without this the
  // arrival stops repeated day 1's 札幌市時計台.
  lockedPlaceIds: string[] = []
): Promise<Array<Record<string, unknown>>> {
  const scheduled = await generateTransitDayStopsViaScheduler(
    fromCity,
    toCity,
    currency,
    budget,
    preferenceIntent,
    lockedPlaceIds
  );
  if (scheduled) return scheduled;
  return generateTransitDayStopsWithLLM(fromCity, toCity, currency);
}

/**
 * The trip's final day (the return flight itself) still has a free morning/
 * early afternoon in its last city — plan/hybrid-rule-engine-scheduling.md
 * Phase 5(a)'s one genuinely new piece (no Phase 3/4 precedent, and no prior
 * "pure LLM" implementation to fall back to). Unlike a transit day's arrival
 * activities, how many stops fit here is pure clock arithmetic against
 * `returnDepartureTime` (computeDepartureDayBudget), not a real-world
 * distance judgment call — no LLM involvement in the scheduling decision
 * itself, only in the text copy. Meals for this day are still
 * generateMealsAndAccommodation's job, unconverted — out of scope here.
 * Not wired into any route yet; returns [] (not null) on any failure since
 * there's no LLM fallback to defer to — an empty return day is itself a
 * valid outcome (e.g. a very early flight leaves no time for anything).
 */
export async function generateDepartureDayStops(
  cityName: string,
  currency: string,
  returnDepartureTime: string | undefined,
  budget: BudgetLevel | undefined,
  preferenceIntent: PreferenceIntent = NEUTRAL_PREFERENCE_INTENT,
  // Places already used elsewhere in this city's block this request (its own
  // transit-arrival stops and/or sightseeing days) — assembleItineraryDays.ts
  // is the first caller that can generate more than one batch of stops for
  // the same city in one request, so without this the same top-rated
  // landmark can get suggested twice in the same trip.
  lockedPlaceIds: string[] = [],
  // Where the traveler stayed; scores and routes from here. Defaults to the city center.
  lodging?: { lat: number; lng: number }
): Promise<Array<Record<string, unknown>>> {
  try {
    const dayStartMinute = dayStartFor(preferenceIntent);
    const returnDepartureMinute = returnDepartureTime
      ? parseTimeString(returnDepartureTime, DEFAULT_ARRIVAL_MINUTE)
      : undefined;
    const { cutoffMinute, estimatedCount } = computeDepartureDayBudget(returnDepartureMinute, dayStartMinute);
    if (estimatedCount === 0) return [];

    const apiKey = process.env.GOOGLE_PLACES_API_KEY!;
    const coords = await getCityCenter(cityName, apiKey);
    if (!coords) return [];

    // The full pool, not just the top few: the most popular places are the
    // ones earlier days already used, so slicing before excluding them left
    // the return day empty (Stockholm day 14, Sapporo day 7). Same cost — the
    // cache always holds 20.
    const places = await fetchNearbyPlaceCandidates(coords, apiKey, ["tourist_attraction"], 10000, 20);
    if (places.length === 0) return [];

    const lockedIds = new Set(lockedPlaceIds);
    const pool = await withSupplementalAttractions(
      coords,
      apiKey,
      places.filter((p) => !lockedIds.has(p.placeId)),
      lockedIds,
      estimatedCount
    );
    const { candidates, candidateById } = placeCandidatesToStopCandidates(pool);
    if (candidates.length === 0) return [];

    const interestWeights = interestWeightsOf(preferenceIntent.interestBoost);
    const anchor = lodging ?? coords;
    const skeleton = buildDaySkeleton(candidates, {
      count: estimatedCount,
      pace: preferenceIntent.pace ?? undefined,
      dayStartMinute,
      dayEndMinute: cutoffMinute,
      interestWeights,
      anchor,
      origin: anchor,
    });

    // assignTimeSlots schedules strictly in order, so filtering by cutoff
    // only ever trims a trailing overrun — never leaves a gap mid-day.
    const withinCutoff = skeleton.filter((s) => s.endMinute <= cutoffMinute);
    if (withinCutoff.length === 0) return [];

    const hintById = new Map<string, RestaurantHint>();
    for (const [id, place] of candidateById) {
      hintById.set(id, { name: place.name, rating: place.rating, lat: place.lat, lng: place.lng, types: place.types });
    }

    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const [copy, distances] = await Promise.all([
      generateSkeletonCopy(withinCutoff, hintById, preferenceIntent, model, cityName),
      getDistancesForStopPairs(
        withinCutoff.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng })),
        pickModeForDistance
      ),
    ]);

    return assembleScheduledStops(withinCutoff, candidateById, copy, distances, currency);
  } catch (err) {
    console.warn("[generateDepartureDayStops] returning no extra stops:", err);
    return [];
  }
}

// Search radius around the city center for meal/lodging candidates — same
// 3km the accommodation regenerate route uses for its hotel pool.
const MEAL_LODGING_RADIUS_M = 3000;
const MEAL_LODGING_MAX_COUNT = 20;

const isBrunchPlace = (p: PlaceCandidate) => p.types?.[0] === "brunch_restaurant";

function uniqueByPlaceId(places: PlaceCandidate[]): PlaceCandidate[] {
  const seen = new Set<string>();
  return places.filter((p) => !seen.has(p.placeId) && seen.add(p.placeId));
}

/** Traveler preferences that change which places meals come from (plan/form-preference-wiring.md 1d). */
export type MealPreferences = {
  dietaryRestrictions?: string[];
  startTimePreference?: PreferenceIntent["startTimePreference"];
};

export function mealPreferencesOf(intent: PreferenceIntent): MealPreferences {
  return { dietaryRestrictions: intent.dietaryRestrictions, startTimePreference: intent.startTimePreference };
}

async function fetchMealLodgingPools(
  cityName: string,
  budget: BudgetLevel | undefined,
  currency: string,
  stayDays: number,
  { dietaryRestrictions = [], startTimePreference }: MealPreferences
): Promise<MealLodgingPools | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;
  // In a city with a known stay district for this budget (Tokyo), lodging and
  // meals are searched there rather than around the city center.
  const stayArea = stayAreaFor(cityName, budget);
  const coords = stayArea ? { lat: stayArea.lat, lng: stayArea.lng } : await getCityCenter(cityName, apiKey);
  if (!coords) return null;

  // Only lunch/dinner needs Enterprise fields (its budget ranking reads
  // priceRange, plan/form-preference-wiring.md 1c-2); breakfast/snack have no
  // budget cap and lodging tiers by type and brand (fetchLodgingCandidates),
  // so those stay on Pro.
  const search = async (types: string[], tier: FieldTier, keep: (p: PlaceCandidate) => boolean = () => true) =>
    (await fetchNearbyPlaceCandidates(coords, apiKey, types, MEAL_LODGING_RADIUS_M, MEAL_LODGING_MAX_COUNT, tier)).filter(keep);

  // A vegetarian/vegan/halal traveler gets one extra search for restaurants
  // of exactly that type, put first — a real filter, not just a prompt hint.
  const dietTypes = dietRequiredTypes(dietaryRestrictions);

  // Breakfast and snack share one café search, split locally (cafeMealSlots.ts).
  const [cafes, main, dietMain, luxuryMain, lodging, twdPerUnit] = await Promise.all([
    search(getMealPlaceTypes("breakfast", budget), "pro", isFoodPlace),
    search(getMealPlaceTypes("lunch", budget), "enterprise", isFoodPlace),
    dietTypes.length > 0 ? search(dietTypes, "enterprise", isFoodPlace) : Promise.resolve([]),
    budget === "luxury" ? fetchLuxuryRestaurants(coords, apiKey, MEAL_LODGING_RADIUS_M) : Promise.resolve([]),
    fetchLodgingCandidates(coords, apiKey, budget, MEAL_LODGING_RADIUS_M, MEAL_LODGING_MAX_COUNT),
    budget ? getTwdRates() : Promise.resolve({}),
  ]);
  // One breakfast and one snack per day of the stay.
  const split = splitCafePool(excludeByDiet(cafes, dietaryRestrictions), stayDays);
  // Getting up late means brunch, so brunch places lead the breakfast list.
  const breakfast =
    startTimePreference === "late"
      ? [...split.breakfast.filter(isBrunchPlace), ...split.breakfast.filter((p) => !isBrunchPlace(p))]
      : split.breakfast;

  // Diet-specific places first (the stronger constraint), then price-filtered
  // luxury places, then the regular popularity pool; budget ranking below
  // still orders them by fit.
  const allMain = excludeByDiet(uniqueByPlaceId([...dietMain, ...luxuryMain, ...main]), dietaryRestrictions)
    .filter(isFoodPlace)
    .filter(fitsMainMeal);
  // Lunch + dinner each day draw from the same pool.
  const rankedMain = rankMainMealsByBudget(allMain, budget, currency, twdPerUnit, stayDays * 2);
  return { breakfast, main: rankedMain, snack: split.snack, lodging };
}

export async function generateMealsAndAccommodation(
  cityName: string,
  stayDays: number,
  currency: string,
  budget?: BudgetLevel,
  preferences: MealPreferences = {},
): Promise<{ accommodation: Record<string, unknown>; mealsByDay: Array<Record<string, unknown>> }> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  // Real candidates first: 4 Nearby Searches per city (cached 30 days per
  // city center) replace one Text Search per meal/hotel during enrich, and
  // the LLM can't invent a name that later comes back "not found". Any
  // failure here just means the old invent-the-names prompt below.
  const pools = await fetchMealLodgingPools(cityName, budget, currency, stayDays, preferences).catch(() => null);
  const useCandidates = pools !== null && hasAnyCandidates(pools);

  const lateRiserRule =
    preferences.startTimePreference === "late" ? "\n- 旅客晚起（約 11:00 出門），早餐請選早午餐" : "";
  const preferenceRules = dietPromptLine(preferences.dietaryRestrictions ?? []) + lateRiserRule;

  if (!useCandidates) {
    const parsed = await askMealsAndLodging(model, cityName, stayDays, currency, preferenceRules, null, true);
    return {
      accommodation: parsed.accommodation ?? {},
      mealsByDay: Array.from({ length: stayDays }, (_, i) => parsed.meals?.[i] ?? {}),
    };
  }

  // A long stay is asked for in chunks: one reply covering 14 days came back
  // truncated, leaving the last days without meals. Each chunk lists unused
  // candidates first, and applyMealPicks fills anything left empty with a
  // real candidate, repeating one only after the pool is used up.
  const history = newPickHistory();
  let accommodation: Record<string, unknown> = {};
  const mealsByDay: Array<Record<string, unknown>> = [];
  for (let start = 0; start < stayDays; start += MEAL_CHUNK_DAYS) {
    const days = Math.min(MEAL_CHUNK_DAYS, stayDays - start);
    const isFirst = start === 0;
    const chunkPools = isFirst ? pools : unusedFirst(pools, history);
    // A failed chunk still gets meals: every slot is filled from candidates.
    const parsed = await askMealsAndLodging(model, cityName, days, currency, preferenceRules, chunkPools, isFirst).catch(
      (err) => {
        console.warn(`[generateMealsAndAccommodation] chunk from day ${start} failed, filling from candidates:`, err);
        return {} as ParsedMealsReply;
      }
    );
    if (isFirst) accommodation = applyAccommodationPick(parsed.accommodation, chunkPools, currency);
    mealsByDay.push(...applyMealPicks(parsed.meals, chunkPools, days, currency, history, start));
  }
  return { accommodation, mealsByDay };
}

// Days of meals asked for per LLM call — see generateMealsAndAccommodation.
const MEAL_CHUNK_DAYS = 5;

type ParsedMealsReply = {
  accommodation?: Record<string, unknown>;
  meals?: Array<Record<string, unknown>>;
};

/**
 * One meal (and, for the first chunk, lodging) picking call. With `pools`
 * the LLM picks from real candidates by id; without, it names places itself
 * (the pre-candidate fallback).
 */
async function askMealsAndLodging(
  model: string,
  cityName: string,
  stayDays: number,
  currency: string,
  preferenceRules: string,
  pools: MealLodgingPools | null,
  askLodging: boolean,
): Promise<ParsedMealsReply> {
  const candidateRules = pools
    ? `

以下是 ${cityName} 真實存在的店家候選（Google 地圖資料）。每個欄位都要從對應清單中選一個，並在 "id" 填入它的編號（例如 "M3"），"name" 照抄清單上的名稱：
- ${askLodging ? "住宿從「住宿候選」選一個" : "住宿已經決定，accommodation 回傳空物件 {} 即可"}
- 早餐從「早餐候選」選，午餐和晚餐都從「午餐／晚餐候選」選，點心從「點心候選」選
- 清單越前面的店越優先；同一家店不要在同一天出現兩次（午餐和晚餐也不能選同一家），也不要在相鄰兩天重複
- 某個清單完全沒有候選時，才自行推薦真實店家，id 填 null

${formatCandidateLists(pools)}`
    : "";
  const idField = pools ? `"id": "候選編號或 null", ` : "";

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `你是專業的旅遊規劃專家。請為旅行者在 ${cityName} 停留 ${stayDays} 天的行程推薦住宿和每日四餐（早餐、午餐、晚餐、點心）。

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "accommodation": { ${idField}"name": "住宿名稱（使用原文或英文）", "area": "所在區域" },
  "meals": [
    {
      "breakfast": { ${idField}"name": "餐廳名稱", "description": "一句話簡介", "estimated_cost": 0 },
      "lunch": { ${idField}"name": "餐廳名稱", "description": "一句話簡介", "estimated_cost": 0 },
      "dinner": { ${idField}"name": "餐廳名稱", "description": "一句話簡介", "estimated_cost": 0 },
      "snack": { ${idField}"name": "咖啡館或甜點店名稱", "description": "一句話簡介", "estimated_cost": 0 }
    }
  ]
}

規則：
- accommodation 為整個在 ${cityName} 停留期間的住宿，必須是真實存在且可在 Booking.com 找到的飯店
- meals 陣列共 ${stayDays} 個元素，每天推薦不同的餐廳
- 所有餐廳必須是 ${cityName} 真實存在的知名店家；snack 須為咖啡館、甜點店或冰淇淋店，不可填正餐型餐廳
- estimated_cost 為 ${currency} 整數，代表每人平均消費${preferenceRules}${candidateRules}`,
      },
      {
        role: "user",
        content: `請為旅行者在 ${cityName} 停留 ${stayDays} 天推薦住宿和每日四餐（早餐、午餐、晚餐、點心）。`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0].message.content;
  if (!content) return {};
  return JSON.parse(content) as ParsedMealsReply;
}

// Falls back to this pure-LLM implementation whenever the rule-engine path
// (generateDayStopsViaScheduler, below) can't produce a real candidate pool
// for the city (see plan/hybrid-rule-engine-scheduling.md Phase 3).
async function generateDayStopsWithLLM(
  cityName: string,
  stayDays: number,
  currency: string
): Promise<Array<Array<Record<string, unknown>>>> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `你是專業的旅遊規劃專家。請為旅行者規劃在 ${cityName} 停留 ${stayDays} 天的景點行程。

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "days": [
    {
      "stops": [
        {
          "name": "景點名稱（繁體中文）",
          "description": "景點描述（繁體中文，1-2 句話）",
          "duration_minutes": 120,
          "time_of_day": "morning",
          "transport_from_prev": "步行約 10 分鐘",
          "estimated_cost": 0
        }
      ]
    }
  ]
}

規則：
- 共生成 ${stayDays} 天，每天 3-4 個景點
- time_of_day 只能是 "morning"、"afternoon"、"evening" 之一
- duration_minutes 為整數（分鐘）
- estimated_cost 為 ${currency} 貨幣的整數，免費景點填 0
- transport_from_prev 必須包含預估時間，例如「步行約 10 分鐘」、「搭乘地鐵約 15 分鐘」，不可只寫交通方式（如「步行」、「地鐵」）
- 所有景點必須是 ${cityName} 真實存在的知名地點`,
      },
      {
        role: "user",
        content: `請規劃 ${cityName} 停留 ${stayDays} 天的景點行程。`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0].message.content;
  if (!content) return Array.from({ length: stayDays }, () => []);

  const parsed = JSON.parse(content) as { days?: Array<{ stops?: unknown[] }> };
  const aiDays = parsed.days ?? [];

  return Array.from({ length: stayDays }, (_, i) => {
    const stops = aiDays[i]?.stops;
    if (!Array.isArray(stops) || stops.length === 0) {
      console.warn(`[generateDayStopsWithLLM] ${cityName} day ${i + 1}/${stayDays} came back with no stops`);
      return [];
    }
    return stops.map((stop) => ({
      ...(stop as Record<string, unknown>),
      id: crypto.randomUUID(),
    }));
  });
}

// When a sightseeing day starts, by the form's 出門時間 (plan/form-preference-
// wiring.md 1.6): early = out before 8:00, normal = 9:00, late = after 11:00.
// "normal" is also the default when nothing was chosen.
const START_TIME_MINUTE: Record<NonNullable<PreferenceIntent["startTimePreference"]>, number> = {
  early: 7 * 60 + 30,
  normal: 9 * 60,
  late: 11 * 60,
};

function dayStartFor(preferenceIntent: PreferenceIntent): number {
  return START_TIME_MINUTE[preferenceIntent.startTimePreference ?? "normal"];
}

// Sightseeing stops spread out until dinner (assignTimeSlots' dinner window
// opens at 18:00) instead of all finishing before lunch.
const SIGHTSEEING_DAY_END_MINUTE = 18 * 60;

// How far past SIGHTSEEING_DAY_END_MINUTE the last stop may still end — dinner
// runs until 20:00. Without it, a culture trip lost a 3-hour museum that ran
// to 18:15. Replaying every cached pool, 30 minutes kept 46 of 56 dropped
// stops while adding only about 1% more stops overall, so the pace levels stay
// apart. Only the trimming uses it: capacity and stretching still aim for 18:00.
const DAY_END_GRACE_MINUTES = 30;

// A second look at a city once its 20 tourist_attraction results run out —
// a 14-day Stockholm trip had 1 stop a day from day 8 and an empty return
// day. Nearby Search has no paging, so this asks for a different mix of
// types instead (Pro fields, cached like any pool).
const SUPPLEMENT_ATTRACTION_TYPES = ["museum", "art_gallery", "park", "historical_landmark", "observation_deck"];

/**
 * `places` (already free of used ones) plus, only when fewer than `needed`
 * are left, places from SUPPLEMENT_ATTRACTION_TYPES that aren't in the pool
 * or used yet. Short trips never pay for the extra search.
 */
async function withSupplementalAttractions(
  coords: { lat: number; lng: number },
  apiKey: string,
  places: PlaceCandidate[],
  usedIds: Set<string>,
  needed: number
): Promise<PlaceCandidate[]> {
  if (places.length >= needed) return places;
  const extra = await fetchNearbyPlaceCandidates(coords, apiKey, SUPPLEMENT_ATTRACTION_TYPES, 10000, 20);
  const inPool = new Set(places.map((p) => p.placeId));
  return [...places, ...extra.filter((p) => !inPool.has(p.placeId) && !usedIds.has(p.placeId))];
}

// estimateStopCapacity only approximates how many stops fit (it uses the
// pool's average stay, and an interest can favor longer ones), so drop
// whatever still ends past the day's end plus DAY_END_GRACE_MINUTES.
// assignTimeSlots schedules strictly in order, so this only ever trims
// trailing stops, never leaves a gap mid-day.
function withinDayEnd(skeleton: SkeletonStop[], dayEndMinute: number): SkeletonStop[] {
  return skeleton.filter((s) => s.endMinute <= dayEndMinute + DAY_END_GRACE_MINUTES);
}

// Shared by generateDayStopsViaScheduler and generateTransitDayStopsViaScheduler
// — both pick/order/time-slot a candidate pool via buildDaySkeleton and then
// need the exact same Stop-shape assembly (real placeId/name/address from the
// candidate, LLM copy with a fallback, computed transport/cost).
function assembleScheduledStops(
  skeleton: SkeletonStop[],
  candidateById: Map<string, PlaceCandidate>,
  copy: Awaited<ReturnType<typeof generateSkeletonCopy>>,
  distances: Awaited<ReturnType<typeof getDistancesForStopPairs>>,
  currency: string
): Array<Record<string, unknown>> {
  return skeleton.map((s, i) => {
    const place = candidateById.get(s.id)!;
    const dist = i > 0 ? distances[i - 1] : null;
    const stopCopy = copy.stops[s.id];
    const description = stopCopy
      ? stopCopy.description + (stopCopy.highlight ? ` ${stopCopy.highlight}` : "")
      : `前往 ${place.name}。`;

    return {
      // A stop's own id, not the place's: the same place can legitimately
      // appear twice in a trip (e.g. a loop back to the arrival city), and
      // the UI and every stop-editing route look stops up by id.
      id: crypto.randomUUID(),
      placeId: s.id,
      name: place.name,
      description,
      duration_minutes: s.estimatedDurationMinutes,
      time_of_day: s.time_of_day,
      ...(dist ? { transport_from_prev: describeTransport(dist.mode, dist.durationSeconds) } : {}),
      estimated_cost: estimateAttractionCost(currency, place.priceLevel),
      lat: s.lat,
      lng: s.lng,
      address: place.address,
      rating: place.rating ?? null,
      photoName: place.photoName ?? null,
    };
  });
}

/**
 * Rule-engine path for generateDayStops (plan/hybrid-rule-engine-scheduling.md
 * Phase 3, section 0.1 point 6's京都 end-to-end chain, now wired into a real
 * caller): builds a real candidate pool via Google Places, lets the pure
 * scheduler modules pick/order/time-slot each day, and only asks the LLM to
 * fill in text copy. Returns null whenever the pool can't be built (no city
 * center, no candidates, or any unexpected error) so the caller falls back to
 * the pure-LLM implementation instead of surfacing a half-built day.
 */
async function generateDayStopsViaScheduler(
  cityName: string,
  dayCount: number,
  currency: string,
  lockedPlaceIds: string[],
  budget: BudgetLevel | undefined,
  preferenceIntent: PreferenceIntent,
  firstDayStartMinute: number | undefined,
  lodging: { lat: number; lng: number } | undefined,
  firstThemeIndex: number
): Promise<ThemedDayStops | null> {
  try {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY!;

    const coords = await getCityCenter(cityName, apiKey);
    if (!coords) return null;

    const dayThemes = dayThemeKeys(themesOf(preferenceIntent.interestBoost), dayCount, firstThemeIndex);
    const cityThemes = [...new Set(dayThemes.filter((t): t is ThemeKey => t !== undefined))];

    // Always the full pool: how many stops a day gets now depends on pace and
    // candidate types (estimateStopCapacity), not a fixed count, and the
    // Nearby cache stores 20 regardless, so asking for fewer saves nothing.
    // Each theme used in this city adds its own pool (cached like any other).
    const [places, ...themePools] = await Promise.all([
      fetchNearbyPlaceCandidates(coords, apiKey, ["tourist_attraction"], 10000, 20),
      ...cityThemes.map((theme) => fetchNearbyPlaceCandidates(coords, apiKey, THEMES[theme].searchTypes, 10000, 20)),
    ]);
    if (places.length === 0) return null;
    const popularIds = new Set(places.map((p) => p.placeId));
    const merged = [...places];
    const themeOnlyIds = new Set<string>();
    for (const place of themePools.flat()) {
      if (merged.some((p) => p.placeId === place.placeId)) continue;
      merged.push(place);
      themeOnlyIds.add(place.placeId);
    }

    const lockedIds = new Set(lockedPlaceIds);
    const pace = preferenceIntent.pace ?? "moderate";
    const dayStartMinute = dayStartFor(preferenceIntent);
    const dayStarts = Array.from({ length: dayCount }, (_, dayIdx) =>
      dayIdx === 0 ? (firstDayStartMinute ?? dayStartMinute) : dayStartMinute
    );
    // Estimated without the theme pools: a culture pool is mostly 3-hour
    // museums, which cut the estimate to 2 stops a day, while the places
    // actually picked near the lodging were 2-hour sights — culture days ended
    // by 15:00. Longer days than estimated get trimmed at the day's end anyway.
    const capacitiesFor = (pool: PlaceCandidate[]) => {
      const estimateFrom = pool.filter((p) => !themeOnlyIds.has(p.placeId));
      const candidateTypes = placeCandidatesToStopCandidates(estimateFrom).candidates.map((c) => c.type);
      return dayStarts.map((start) =>
        estimateStopCapacity({ pace, dayStartMinute: start, dayEndMinute: SIGHTSEEING_DAY_END_MINUTE, candidateTypes })
      );
    };

    const available = merged.filter((p) => !lockedIds.has(p.placeId));
    const neededStops = capacitiesFor(available).reduce((sum, n) => sum + n, 0);
    const pool = await withSupplementalAttractions(coords, apiKey, available, lockedIds, neededStops);

    const { candidates, candidateById } = placeCandidatesToStopCandidates(pool);
    if (candidates.length === 0) return null;

    const hintById = new Map<string, RestaurantHint>();
    for (const [id, place] of candidateById) {
      hintById.set(id, { name: place.name, rating: place.rating, lat: place.lat, lng: place.lng, types: place.types });
    }

    const interestWeights = interestWeightsOf(preferenceIntent.interestBoost);
    const capacities = capacitiesFor(pool);

    // rating × preference × distance from where the traveler sleeps (the
    // city center when the lodging isn't known), and each day's route starts
    // there too.
    const anchor = lodging ?? coords;
    const counts = distributeStopsPerDay(candidates.length, capacities);
    const onTheme = (theme: ThemeKey) => (c: { id: string }) => isOnTheme(candidateById.get(c.id)?.types, theme);
    const dayGroups = partitionCandidatesByDay(candidates, counts, interestWeights, anchor, {
      themes: dayThemes.map((theme, dayIdx) =>
        theme ? { onTheme: onTheme(theme), themeCount: counts[dayIdx] - popularSlots(counts[dayIdx]) } : undefined
      ),
      isPopular: (c) => popularIds.has(c.id),
    });
    const skeletonsByDay: SkeletonStop[][] = dayGroups.map((group, dayIdx) =>
      group.length > 0
        ? withinDayEnd(
            buildDaySkeleton(group, {
              count: group.length,
              pace,
              dayStartMinute: dayStarts[dayIdx],
              dayEndMinute: SIGHTSEEING_DAY_END_MINUTE,
              interestWeights,
              anchor,
              origin: anchor,
            }),
            SIGHTSEEING_DAY_END_MINUTE
          )
        : []
    );

    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const [copies, distancesByDay] = await Promise.all([
      Promise.all(
        skeletonsByDay.map((skeleton) =>
          generateSkeletonCopy(skeleton, hintById, preferenceIntent, model, cityName)
        )
      ),
      Promise.all(
        skeletonsByDay.map((skeleton) =>
          getDistancesForStopPairs(
            skeleton.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng })),
            pickModeForDistance
          )
        )
      ),
    ]);

    return {
      stopsByDay: skeletonsByDay.map((skeleton, dayIdx) =>
        assembleScheduledStops(skeleton, candidateById, copies[dayIdx], distancesByDay[dayIdx], currency)
      ),
      // A day only claims its theme when it actually got an on-theme stop.
      themeByDay: skeletonsByDay.map((skeleton, dayIdx) => {
        const theme = dayThemes[dayIdx];
        return theme && skeleton.some(onTheme(theme)) ? theme : undefined;
      }),
    };
  } catch (err) {
    console.warn("[generateDayStopsViaScheduler] falling back to LLM:", err);
    return null;
  }
}

export type ThemedDayStops = {
  stopsByDay: Array<Array<Record<string, unknown>>>;
  /** Each day's theme (plan/form-preference-wiring.md 1.4), undefined for a day without one. */
  themeByDay: (ThemeKey | undefined)[];
};

/**
 * generateDayStops plus each day's theme, for callers that title the days.
 * The LLM fallback has no themes.
 */
export async function generateThemedDayStops(
  cityName: string,
  stayDays: number,
  currency: string,
  lockedPlaceIds: string[] = [],
  budget?: BudgetLevel,
  preferenceIntent: PreferenceIntent = NEUTRAL_PREFERENCE_INTENT,
  // Overrides only the first requested day's start time — used for the
  // trip's actual first day (flight arrival), see
  // scheduler/arrivalDayStart.ts and assembleItineraryDays.ts. undefined
  // preserves the existing per-preference/default behavior for every
  // existing caller (restructure/route.ts never passes this).
  firstDayStartMinute?: number,
  // Where the traveler stays in this city — stops are scored by distance from
  // it and each day's route starts there. Defaults to the city center.
  lodging?: { lat: number; lng: number },
  // Where the theme rotation continues from — the trip's sightseeing days so
  // far, so each city doesn't restart at the first theme.
  firstThemeIndex = 0
): Promise<ThemedDayStops> {
  const scheduled = await generateDayStopsViaScheduler(
    cityName,
    stayDays,
    currency,
    lockedPlaceIds,
    budget,
    preferenceIntent,
    firstDayStartMinute,
    lodging,
    firstThemeIndex
  );
  if (scheduled) return scheduled;
  const stopsByDay = await generateDayStopsWithLLM(cityName, stayDays, currency);
  return { stopsByDay, themeByDay: stopsByDay.map(() => undefined) };
}

export async function generateDayStops(
  ...args: Parameters<typeof generateThemedDayStops>
): Promise<Array<Array<Record<string, unknown>>>> {
  return (await generateThemedDayStops(...args)).stopsByDay;
}

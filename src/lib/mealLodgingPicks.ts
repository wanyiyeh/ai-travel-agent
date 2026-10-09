import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";
import type { MealType } from "@/types/itinerary";
import { estimateSlotCost, estimateLodgingCostPerNight, estimateLodgingCostRange } from "@/lib/priceLevelCost";
import { estimateFromPriceRange } from "@/lib/mealBudget";

// Real Nearby Search candidates for one city's meals and accommodation, handed
// to the LLM as numbered lists so it picks real places instead of inventing
// names. The old flow had the LLM make every name up, then paid one Text
// Search per meal/hotel during enrich to find out where it was — and names it
// invented outright came back "not found" (see plan/places-api-cost-reduction.md).
// A pick carries the candidate's placeId/coords straight through, so enrich
// skips it entirely.

export type MealLodgingPools = {
  breakfast: PlaceCandidate[];
  main: PlaceCandidate[]; // shared by lunch and dinner
  snack: PlaceCandidate[];
  lodging: PlaceCandidate[];
  /** Bars and izakaya for the 小酌 after dinner; empty unless the traveler picked 酒. */
  nightcap: PlaceCandidate[];
  /**
   * The traveler's drink places (drinkPlaces.ts), one list per drink: day d's
   * snack comes from list d % length, so coffee and tea alternate. Each list
   * is also in `snack`, which the prompt shows; `snack` is the fallback when
   * the day's list has nothing left.
   */
  snackRotation?: PlaceCandidate[][];
};

type PoolKey = "breakfast" | "main" | "snack" | "lodging" | "nightcap";

const ID_PREFIX: Record<PoolKey, string> = { breakfast: "B", main: "M", snack: "S", lodging: "H", nightcap: "N" };
const POOL_FOR_MEAL: Record<MealType, PoolKey> = {
  breakfast: "breakfast",
  lunch: "main",
  dinner: "main",
  snack: "snack",
  nightcap: "nightcap",
};
const MEAL_KEYS: MealType[] = ["breakfast", "lunch", "dinner", "snack", "nightcap"];

function candidateId(pool: PoolKey, index: number): string {
  return `${ID_PREFIX[pool]}${index + 1}`;
}

function findCandidate(pools: MealLodgingPools, pool: PoolKey, id: unknown): PlaceCandidate | undefined {
  if (typeof id !== "string" || !id.startsWith(ID_PREFIX[pool])) return undefined;
  const index = Number(id.slice(ID_PREFIX[pool].length)) - 1;
  return Number.isInteger(index) ? pools[pool][index] : undefined;
}

export function hasAnyCandidates(pools: MealLodgingPools): boolean {
  return Object.values(pools).some((p) => p.length > 0);
}

// The candidate lists as they appear in the prompt, one line per place.
export function formatCandidateLists(pools: MealLodgingPools): string {
  const section = (title: string, pool: PoolKey) => {
    const lines = pools[pool].map(
      (c, i) => `${candidateId(pool, i)}: ${c.name}${c.rating ? `（${c.rating}★）` : ""}`,
    );
    return `${title}：\n${lines.length > 0 ? lines.join("\n") : "（無候選，請自行推薦真實店家，id 填 null）"}`;
  };
  return [
    section("住宿候選", "lodging"),
    section("早餐候選", "breakfast"),
    section("午餐／晚餐候選", "main"),
    section("點心候選", "snack"),
    // Only for a traveler who picked 酒 — an empty section would tell the
    // model to recommend bars on its own.
    ...(pools.nightcap.length > 0 ? [section("小酌候選", "nightcap")] : []),
  ].join("\n\n");
}

/**
 * A prompt line telling the LLM which snack candidates each day of a chunk
 * should come from, when drinks rotate. Without it the LLM picked ordinary
 * sweet shops, the rotation swapped every one out, and the swapped-in places
 * had no description. Empty without a rotation.
 */
export function snackRotationRule(pools: MealLodgingPools, dayOffset: number, days: number): string {
  const rotation = pools.snackRotation;
  if (!rotation?.length) return "";
  const lines = Array.from({ length: days }, (_, i) => {
    const ids = rotation[(dayOffset + i) % rotation.length]
      .map((place) => pools.snack.indexOf(place))
      .filter((index) => index >= 0)
      .map((index) => candidateId("snack", index));
    return `第 ${i + 1} 天：${ids.join("、")}`;
  });
  return `\n- 旅客選了飲品，點心照天數從這些候選選：${lines.join("；")}`;
}

type RawPick = Record<string, unknown>;

// A place may come back on a later day once a stay has used every
// candidate (a 14-day stay needs 28 lunches/dinners from a 20-place pool),
// but never the same day or the next — see pickForSlot.
const MIN_REPEAT_GAP_DAYS = 2;

/**
 * Which candidate was last used on which day of the stay (0-based), and the
 * description the LLM wrote for it — carried across chunks so a later chunk
 * knows what's been used and a repeat can reuse the original description.
 * Keyed by object: breakfast and snack lists hold the same café objects, so
 * one café can't be both on the same day.
 */
export type PickHistory = {
  lastDay: Map<PlaceCandidate, number>;
  visits: Map<PlaceCandidate, number>;
  description: Map<PlaceCandidate, unknown>;
};

export function newPickHistory(): PickHistory {
  return { lastDay: new Map(), visits: new Map(), description: new Map() };
}

/** The same pools with never-used candidates first, for a later chunk's prompt. */
export function unusedFirst(pools: MealLodgingPools, history: PickHistory): MealLodgingPools {
  const reorder = (pool: PlaceCandidate[]) => [
    ...pool.filter((c) => !history.lastDay.has(c)),
    ...pool.filter((c) => history.lastDay.has(c)),
  ];
  return {
    breakfast: reorder(pools.breakfast),
    main: reorder(pools.main),
    snack: reorder(pools.snack),
    lodging: pools.lodging,
    nightcap: reorder(pools.nightcap),
    snackRotation: pools.snackRotation,
  };
}

const stripId = (raw: RawPick) => {
  const rest = { ...raw };
  delete rest.id;
  return rest;
};

/** The LLM's lodging pick filled with the candidate's real place data, or its own entry when it named no valid candidate. */
export function applyAccommodationPick(
  rawAcc: RawPick | undefined,
  pools: MealLodgingPools,
  currency: string,
): Record<string, unknown> {
  const raw = rawAcc ?? {};
  const hotel = findCandidate(pools, "lodging", raw.id);
  if (!hotel) return stripId(raw);
  const range = estimateLodgingCostRange(currency, hotel.priceLevel);
  const perNight = estimateLodgingCostPerNight(currency, hotel.priceLevel);
  return {
    name: hotel.name,
    area: typeof raw.area === "string" && raw.area ? raw.area : hotel.address,
    placeId: hotel.placeId,
    lat: hotel.lat,
    lng: hotel.lng,
    address: hotel.address,
    rating: hotel.rating ?? null,
    priceLevel: hotel.priceLevel ?? null,
    photoName: hotel.photoName ?? null,
    ...(perNight !== undefined ? { estimated_cost: perNight } : {}),
    ...(range ? { estimated_cost_low: range[0], estimated_cost_high: range[1] } : {}),
  };
}

/**
 * Which real candidate serves a meal slot on `day`. The LLM's own pick when
 * it's a candidate not used yet; otherwise a candidate not used yet (keeping
 * pool order). Once every candidate has been used: one of the
 * least-visited places not used in the last MIN_REPEAT_GAP_DAYS - 1 days,
 * rotating with the day and slot. Always taking the longest-unused one made
 * a whole day copy day 1's; and the LLM's own repeat choice isn't taken
 * either — later chunks list used places in their original order, so it
 * kept picking day 1's places and the same favourite (one izakaya came up
 * four times in 14 days). Undefined when nothing qualifies.
 */
function pickForSlot(
  pool: PlaceCandidate[],
  llmPick: PlaceCandidate | undefined,
  day: number,
  slotIndex: number,
  history: PickHistory,
): PlaceCandidate | undefined {
  if (llmPick && pool.includes(llmPick) && !history.lastDay.has(llmPick)) return llmPick;
  const unused = pool.find((c) => !history.lastDay.has(c));
  if (unused) return unused;
  const spaced = (c: PlaceCandidate) => day - (history.lastDay.get(c) ?? -Infinity) >= MIN_REPEAT_GAP_DAYS;
  const eligible = pool.filter(spaced);
  if (eligible.length === 0) return undefined;
  const fewest = Math.min(...eligible.map((c) => history.visits.get(c) ?? 0));
  const leastVisited = eligible.filter((c) => (history.visits.get(c) ?? 0) === fewest);
  return leastVisited[(day * MEAL_KEYS.length + slotIndex) % leastVisited.length];
}

/**
 * Turns the LLM's meal picks for `days` days (starting at day `dayOffset` of
 * the stay) into meals carrying real place data. Any slot the LLM left
 * empty, got wrong, or picked a used place for — including whole days a
 * truncated reply never reached — is filled with a real candidate by
 * pickForSlot instead of keeping an invented name; only with no candidate at
 * all does the LLM's own entry stay.
 */
export function applyMealPicks(
  rawMeals: RawPick[] | undefined,
  pools: MealLodgingPools,
  days: number,
  currency: string,
  history: PickHistory,
  dayOffset = 0,
): Array<Record<string, unknown>> {
  return Array.from({ length: days }, (_, i) => {
    const dayOfStay = dayOffset + i;
    const rawDay = rawMeals?.[i] ?? {};
    const meals: Record<string, unknown> = {};
    MEAL_KEYS.forEach((mealKey, slotIndex) => {
      const rawValue = rawDay[mealKey];
      const raw = rawValue && typeof rawValue === "object" ? (rawValue as RawPick) : undefined;
      const pool = pools[POOL_FOR_MEAL[mealKey]];
      const llmPick = raw ? findCandidate(pools, POOL_FOR_MEAL[mealKey], raw.id) : undefined;
      const rotation = mealKey === "snack" ? pools.snackRotation : undefined;
      const dayPool = rotation?.length ? rotation[dayOfStay % rotation.length] : undefined;
      // The AI doesn't keep to an alternation it's told about, so the day's
      // drink is enforced here; the full snack list only once it runs dry.
      const place =
        (dayPool && pickForSlot(dayPool, llmPick, dayOfStay, slotIndex, history)) ??
        pickForSlot(pool, llmPick, dayOfStay, slotIndex, history);
      if (!place) {
        if (raw) meals[mealKey] = stripId(raw);
        return;
      }

      history.lastDay.set(place, dayOfStay);
      history.visits.set(place, (history.visits.get(place) ?? 0) + 1);
      const ownPick = place === llmPick;
      if (ownPick && raw?.description !== undefined && !history.description.has(place)) {
        history.description.set(place, raw.description);
      }
      // Google's real per-person range beats the priceLevel lookup table.
      const estimated =
        estimateFromPriceRange(place.priceRange, currency) ?? estimateSlotCost(currency, mealKey, place.priceLevel);
      meals[mealKey] = {
        name: place.name,
        description: ownPick ? raw?.description : history.description.get(place),
        estimated_cost: estimated ?? (ownPick ? raw?.estimated_cost : undefined),
        placeId: place.placeId,
        lat: place.lat,
        lng: place.lng,
        address: place.address,
        rating: place.rating ?? null,
        photoName: place.photoName ?? null,
      };
    });
    return meals;
  });
}

/** Lodging + meals for a stay picked in one LLM call (no chunking). */
export function applyCandidatePicks(
  parsed: { accommodation?: RawPick; meals?: RawPick[] },
  pools: MealLodgingPools,
  stayDays: number,
  currency: string,
): { accommodation: Record<string, unknown>; mealsByDay: Array<Record<string, unknown>> } {
  return {
    accommodation: applyAccommodationPick(parsed.accommodation, pools, currency),
    mealsByDay: applyMealPicks(parsed.meals, pools, stayDays, currency, newPickHistory()),
  };
}

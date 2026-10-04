import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";
import type { MealType } from "@/types/itinerary";
import { estimateMealCost, estimateLodgingCostPerNight, estimateLodgingCostRange } from "@/lib/priceLevelCost";
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
};

type PoolKey = keyof MealLodgingPools;

const ID_PREFIX: Record<PoolKey, string> = { breakfast: "B", main: "M", snack: "S", lodging: "H" };
const POOL_FOR_MEAL: Record<MealType, PoolKey> = { breakfast: "breakfast", lunch: "main", dinner: "main", snack: "snack" };
const MEAL_KEYS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

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
  ].join("\n\n");
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
  return { breakfast: reorder(pools.breakfast), main: reorder(pools.main), snack: reorder(pools.snack), lodging: pools.lodging };
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
 * pool order). Once every candidate has been used: the LLM's pick, or else
 * one of the least-visited places, either only if it wasn't used in the
 * last MIN_REPEAT_GAP_DAYS - 1 days. Which least-visited place rotates with
 * the day and slot — always taking the longest-unused one made a whole day's
 * meals copy day 1's (an Okinawa trip's day 11 matched day 1 exactly).
 * Undefined when nothing qualifies.
 */
function pickForSlot(
  pool: PlaceCandidate[],
  llmPick: PlaceCandidate | undefined,
  day: number,
  slotIndex: number,
  history: PickHistory,
): PlaceCandidate | undefined {
  if (llmPick && !history.lastDay.has(llmPick)) return llmPick;
  const unused = pool.find((c) => !history.lastDay.has(c));
  if (unused) return unused;
  const spaced = (c: PlaceCandidate) => day - (history.lastDay.get(c) ?? -Infinity) >= MIN_REPEAT_GAP_DAYS;
  if (llmPick && spaced(llmPick)) return llmPick;
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
      const place = pickForSlot(pool, llmPick, dayOfStay, slotIndex, history);
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
        estimateFromPriceRange(place.priceRange, currency) ?? estimateMealCost(currency, mealKey, place.priceLevel);
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

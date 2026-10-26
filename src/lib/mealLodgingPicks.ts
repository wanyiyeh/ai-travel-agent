import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";
import type { MealType } from "@/types/itinerary";
import { estimateSlotCost, estimateLodgingCostPerNight, estimateLodgingCostRange } from "@/lib/priceLevelCost";
import { estimateFromPriceRange, isPriceFloor } from "@/lib/mealBudget";

// Real Nearby Search candidates for one city's meals and accommodation,
// picked by rule. Each pool is already in the order to pick from: budget,
// diet and the traveler's preferences (kids, solo, pets, a late start, hot
// springs) are applied when it's built (fetchMealLodgingPools). No Google
// name goes to the model to choose from or describe (ADR-0008). A pick
// carries the candidate's placeId/coords straight through, so enrich skips it.

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
   * is also in `snack`, the fallback when the day's list has nothing left.
   */
  snackRotation?: PlaceCandidate[][];
};

type PoolKey = "breakfast" | "main" | "snack" | "nightcap";

const POOL_FOR_MEAL: Record<MealType, PoolKey> = {
  breakfast: "breakfast",
  lunch: "main",
  dinner: "main",
  snack: "snack",
  nightcap: "nightcap",
};
const MEAL_KEYS: MealType[] = ["breakfast", "lunch", "dinner", "snack", "nightcap"];

// Primary types too broad to say two places serve the same food.
const GENERIC_FOOD_TYPES = new Set(["restaurant", "food", "meal_takeaway", "meal_delivery", "point_of_interest", "establishment"]);

export function hasAnyCandidates(pools: MealLodgingPools): boolean {
  return Object.values(pools).some((p) => p.length > 0);
}

// A place may come back on a later day once a stay has used every
// candidate (a 14-day stay needs 28 lunches/dinners from a 20-place pool),
// but never the same day or the next — see pickForSlot.
const MIN_REPEAT_GAP_DAYS = 2;

/**
 * Which candidate was last used on which day of the stay (0-based), and how
 * often. Keyed by object: breakfast and snack lists hold the same café
 * objects, so one café can't be both on the same day.
 */
export type PickHistory = {
  lastDay: Map<PlaceCandidate, number>;
  visits: Map<PlaceCandidate, number>;
};

export function newPickHistory(): PickHistory {
  return { lastDay: new Map(), visits: new Map() };
}

/**
 * The stay's lodging: the first candidate, the pool being ranked for budget
 * and preferences already. `area` is the city, our own words: Google's
 * address may not be stored (ADR-0004), and it's looked up again for display.
 */
export function pickAccommodation(pools: MealLodgingPools, currency: string, cityName: string): Record<string, unknown> {
  const hotel = pools.lodging[0];
  if (!hotel) return {};
  const range = estimateLodgingCostRange(currency, hotel.priceLevel);
  const perNight = estimateLodgingCostPerNight(currency, hotel.priceLevel);
  return {
    name: hotel.name,
    area: cityName,
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
 * Which candidate serves a meal slot on `day`: the first not used yet, in
 * pool order. Once every candidate has been used: one of the least-visited
 * places not used in the last MIN_REPEAT_GAP_DAYS - 1 days, rotating with
 * the day and slot. Always taking the longest-unused one made a whole day
 * copy day 1's. Undefined when nothing qualifies.
 */
function pickForSlot(pool: PlaceCandidate[], day: number, slotIndex: number, history: PickHistory): PlaceCandidate | undefined {
  const unused = pool.find((c) => !history.lastDay.has(c));
  if (unused) return unused;
  const spaced = (c: PlaceCandidate) => day - (history.lastDay.get(c) ?? -Infinity) >= MIN_REPEAT_GAP_DAYS;
  const eligible = pool.filter(spaced);
  if (eligible.length === 0) return undefined;
  const fewest = Math.min(...eligible.map((c) => history.visits.get(c) ?? 0));
  const leastVisited = eligible.filter((c) => (history.visits.get(c) ?? 0) === fewest);
  return leastVisited[(day * MEAL_KEYS.length + slotIndex) % leastVisited.length];
}

/** A place's own kind of food (ramen_restaurant), or undefined when Google only says "restaurant". */
function specificFoodType(place: PlaceCandidate | undefined): string | undefined {
  const primary = place?.types?.[0];
  return primary && !GENERIC_FOOD_TYPES.has(primary) ? primary : undefined;
}

/**
 * Meals for `days` days starting at day `dayOffset` of the stay, every slot
 * a real candidate (pickForSlot). The day's drink comes from its rotation
 * list first; dinner avoids lunch's kind of food (two ramen shops in one day)
 * when the pool has anything else. A slot nothing qualifies for stays empty.
 */
export function pickMeals(
  pools: MealLodgingPools,
  days: number,
  currency: string,
  history: PickHistory = newPickHistory(),
  dayOffset = 0,
): Array<Record<string, unknown>> {
  return Array.from({ length: days }, (_, i) => {
    const dayOfStay = dayOffset + i;
    const meals: Record<string, unknown> = {};
    let lunchPlace: PlaceCandidate | undefined;
    MEAL_KEYS.forEach((mealKey, slotIndex) => {
      const pool = pools[POOL_FOR_MEAL[mealKey]];
      const rotation = mealKey === "snack" ? pools.snackRotation : undefined;
      const dayPool = rotation?.length ? rotation[dayOfStay % rotation.length] : undefined;
      const lunchType = mealKey === "dinner" ? specificFoodType(lunchPlace) : undefined;
      // Only an unused place of another kind: a repeat doesn't beat a fresh one.
      const freshOtherKind = lunchType
        ? pool.find((c) => c.types?.[0] !== lunchType && !history.lastDay.has(c))
        : undefined;
      const place =
        (dayPool && pickForSlot(dayPool, dayOfStay, slotIndex, history)) ??
        freshOtherKind ??
        pickForSlot(pool, dayOfStay, slotIndex, history);
      if (!place) return;
      if (mealKey === "lunch") lunchPlace = place;

      history.lastDay.set(place, dayOfStay);
      history.visits.set(place, (history.visits.get(place) ?? 0) + 1);
      // Google's real per-person range beats the priceLevel lookup table.
      const estimated =
        estimateFromPriceRange(place.priceRange, currency) ?? estimateSlotCost(currency, mealKey, place.priceLevel);
      meals[mealKey] = {
        name: place.name,
        ...(estimated !== undefined ? { estimated_cost: estimated } : {}),
        ...(isPriceFloor(place.priceRange, currency) ? { estimated_cost_from: true } : {}),
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

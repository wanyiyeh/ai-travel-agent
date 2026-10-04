import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

// Breakfast and snack draw from the same kinds of places (cafés, bakeries),
// so they share one Nearby Search instead of two (plan/form-preference-
// wiring.md 1c-2) and are split locally by Google's primary type. Includes
// breakfast_restaurant/brunch_restaurant so breakfast isn't limited to
// Western cafés (e.g. Japanese teishoku spots).
export const CAFE_MEAL_TYPES = ["breakfast_restaurant", "brunch_restaurant", "cafe", "bakery", "ice_cream_shop"];

// A place whose primary type is one of these suits only one of the two slots.
const BREAKFAST_ONLY = new Set(["breakfast_restaurant", "brunch_restaurant"]);
const SNACK_ONLY = new Set(["ice_cream_shop", "dessert_shop", "dessert_restaurant", "confectionery", "chocolate_shop"]);

export function fitsCafeMealSlot(place: Pick<PlaceCandidate, "types">, slot: "breakfast" | "snack"): boolean {
  const primary = place.types?.[0];
  if (!primary) return true;
  // A full restaurant is no breakfast or afternoon snack: Okinawa's café
  // search returned a curry/ramen diner (primary japanese_curry_restaurant)
  // that ended up as a snack. Dessert restaurants still count as a snack.
  if (primary.endsWith("_restaurant") && !BREAKFAST_ONLY.has(primary) && primary !== "dessert_restaurant") {
    return false;
  }
  return slot === "breakfast" ? !SNACK_ONLY.has(primary) : !BREAKFAST_ONLY.has(primary);
}

// Places that are a sweet or a coffee, not a lunch or dinner. Google's
// "restaurant" search includes them (an Okinawa shaved-ice shop, primary
// dessert_restaurant, was served as dinner).
const NOT_A_MAIN_MEAL = new Set([
  "dessert_restaurant", "dessert_shop", "ice_cream_shop", "confectionery", "chocolate_shop",
  "cafe", "coffee_shop", "coffee_stand", "tea_house", "bakery", "pastry_shop", "donut_shop", "juice_shop",
]);

/** Whether a place from the lunch/dinner search is a real meal, judged by Google's primary type. */
export function fitsMainMeal(place: Pick<PlaceCandidate, "types">): boolean {
  const primary = place.types?.[0];
  return !primary || !NOT_A_MAIN_MEAL.has(primary);
}

/**
 * Splits one shared café pool into breakfast and snack lists. When the pool
 * is big enough that each list still covers `neededPerSlot` meals, no place
 * appears in both: slot-specific places go to their slot and places that
 * suit either (a café, a bakery) alternate between the two, so the LLM isn't
 * offered the same store for both meals. A long stay can't afford that — a
 * 13-day Stockholm trip ran out at ~10 per slot and the LLM started inventing
 * repeats — so then both lists keep every place that suits them (the
 * one-pick-per-place rule in applyCandidatePicks still prevents a store
 * being used twice). Google's popularity order is kept within each list.
 */
export function splitCafePool<T extends Pick<PlaceCandidate, "types">>(
  pool: T[],
  neededPerSlot: number
): { breakfast: T[]; snack: T[] } {
  const breakfast: T[] = [];
  const snack: T[] = [];
  let nextShared: "breakfast" | "snack" = "breakfast";
  for (const place of pool) {
    const forBreakfast = fitsCafeMealSlot(place, "breakfast");
    const forSnack = fitsCafeMealSlot(place, "snack");
    if (forBreakfast && forSnack) {
      (nextShared === "breakfast" ? breakfast : snack).push(place);
      nextShared = nextShared === "breakfast" ? "snack" : "breakfast";
    } else if (forBreakfast) {
      breakfast.push(place);
    } else if (forSnack) {
      snack.push(place);
    }
  }
  if (breakfast.length >= neededPerSlot && snack.length >= neededPerSlot) return { breakfast, snack };
  return {
    breakfast: pool.filter((p) => fitsCafeMealSlot(p, "breakfast")),
    snack: pool.filter((p) => fitsCafeMealSlot(p, "snack")),
  };
}

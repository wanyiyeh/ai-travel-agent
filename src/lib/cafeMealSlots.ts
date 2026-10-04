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
  return slot === "breakfast" ? !SNACK_ONLY.has(primary) : !BREAKFAST_ONLY.has(primary);
}

/**
 * Splits one shared café pool into breakfast and snack lists with no place in
 * both: slot-specific places go to their slot, and places that suit either
 * (a café, a bakery) alternate between the two, so the LLM isn't offered the
 * same store for both meals. Google's popularity order is kept within each list.
 */
export function splitCafePool<T extends Pick<PlaceCandidate, "types">>(pool: T[]): { breakfast: T[]; snack: T[] } {
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
  return { breakfast, snack };
}

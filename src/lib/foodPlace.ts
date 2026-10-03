// Nearby Search's `includedTypes` matches a place if *any* of its types is
// listed, so a meal search for `cafe` also returns department stores, malls
// and cinemas that merely house a café (新宿高島屋 is
// department_store,…,cafe). Google lists a place's own primary type first in
// `types`, so judge by that.
const FOOD_PRIMARY_TYPES = new Set([
  "cafe",
  "coffee_shop",
  "coffee_stand",
  "tea_house",
  "bakery",
  "pastry_shop",
  "donut_shop",
  "bagel_shop",
  "dessert_shop",
  "ice_cream_shop",
  "juice_shop",
  "acai_shop",
  "chocolate_shop",
  "confectionery",
  "sandwich_shop",
  "snack_bar",
  "cafeteria",
  "diner",
  "food_court",
  "meal_takeaway",
  "cat_cafe",
  "dog_cafe",
]);

/**
 * Whether a place is primarily somewhere to eat. Places without `types`
 * (cache rows written before types were fetched) are kept — nothing to
 * judge them by.
 */
export function isFoodPlace(place: { types?: string[] }): boolean {
  const primary = place.types?.[0];
  if (!primary) return true;
  return primary.endsWith("_restaurant") || FOOD_PRIMARY_TYPES.has(primary);
}

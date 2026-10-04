import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

// Dietary restrictions come from the form (fixed tags) and from
// parsePreferenceIntent's free-text parse (LLM-chosen snake_case tags), so
// unknown tags are possible. plan/form-preference-wiring.md 1d.
const DIET_LABELS: Record<string, string> = {
  vegetarian: "素食",
  vegan: "純素",
  no_seafood: "不吃海鮮",
  no_beef: "不吃牛",
  halal: "清真",
  no_spicy: "不吃辣",
};

// Restaurant types that ARE the restriction — searched separately and put
// first, a real filter rather than a prompt hint.
const REQUIRED_TYPES: Record<string, string[]> = {
  vegan: ["vegan_restaurant"],
  vegetarian: ["vegetarian_restaurant", "vegan_restaurant"],
  halal: ["halal_restaurant"],
};

// Primary types built around what the restriction rules out. Only catches
// places centred on it (a seafood restaurant), not a general restaurant that
// happens to serve it — the prompt line covers the rest.
const MEAT_OR_SEAFOOD = ["steak_house", "seafood_restaurant", "sushi_restaurant"];
const EXCLUDED_PRIMARY_TYPES: Record<string, string[]> = {
  no_seafood: ["seafood_restaurant", "sushi_restaurant"],
  no_beef: ["steak_house"],
  vegetarian: MEAT_OR_SEAFOOD,
  vegan: MEAT_OR_SEAFOOD,
};

// Free-text tags reach the system prompt, so only plain snake_case words get
// through — a tag can't carry instructions.
const SAFE_TAG = /^[a-z][a-z_]{0,29}$/;

function safeTags(restrictions: readonly string[]): string[] {
  return [...new Set(restrictions.filter((t) => SAFE_TAG.test(t)))];
}

/** Place types to search first so the pool starts with places that fit, or [] when no restriction has a type of its own. */
export function dietRequiredTypes(restrictions: readonly string[]): string[] {
  return [...new Set(safeTags(restrictions).flatMap((t) => REQUIRED_TYPES[t] ?? []))];
}

/** Drops places whose primary type is built around something the traveler can't eat. */
export function excludeByDiet<T extends Pick<PlaceCandidate, "types">>(places: T[], restrictions: readonly string[]): T[] {
  const excluded = new Set(safeTags(restrictions).flatMap((t) => EXCLUDED_PRIMARY_TYPES[t] ?? []));
  if (excluded.size === 0) return places;
  return places.filter((p) => !excluded.has(p.types?.[0] ?? ""));
}

/** The line added to the meal-picking prompt, or "" with no restrictions. */
export function dietPromptLine(restrictions: readonly string[]): string {
  const tags = safeTags(restrictions);
  if (tags.length === 0) return "";
  const labels = tags.map((t) => DIET_LABELS[t] ?? t).join("、");
  return `\n- 旅客飲食限制：${labels}。所有餐點都要避開不符合的店家（例如以海鮮為主的店），候選清單中不符合的寧可不選`;
}

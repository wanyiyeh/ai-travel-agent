import type { BudgetLevel, PlaceCandidate, PriceRange } from "@/lib/fetchCityRestaurants";
import { estimateMealCost } from "@/lib/priceLevelCost";

// Per-person lunch/dinner budget in NT$ (plan/form-preference-wiring.md 1.3).
// Breakfast and snack have no cap.
export const MAIN_MEAL_BUDGET_TWD: Record<BudgetLevel, { min: number; max: number }> = {
  budget: { min: 0, max: 400 },
  moderate: { min: 0, max: 1000 },
  luxury: { min: 1000, max: 2000 },
};

// Without an exchange rate, Google's 1-4 price level is the only signal left.
const FITTING_PRICE_LEVELS: Record<BudgetLevel, number[]> = {
  budget: [1],
  moderate: [1, 2],
  luxury: [3, 4],
};

export type BudgetFit = "fit" | "unknown" | "outside";
const FIT_ORDER: Record<BudgetFit, number> = { fit: 0, unknown: 1, outside: 2 };

/**
 * Whether a lunch/dinner candidate fits the trip's budget. Prefers Google's
 * per-person priceRange converted to NT$; falls back to the priceLevel-based
 * meal cost estimate; with no exchange rate, to priceLevel alone. A missing
 * upper bound ("$2,000+") counts as unbounded. Budget/moderate fit when the
 * whole range is under the cap; luxury fits when the range overlaps
 * NT$1,000-2,000.
 */
export function mainMealBudgetFit(
  place: Pick<PlaceCandidate, "priceRange" | "priceLevel">,
  budget: BudgetLevel,
  currency: string | undefined,
  twdPerUnit: Record<string, number>
): BudgetFit {
  const { min, max } = MAIN_MEAL_BUDGET_TWD[budget];
  const inBudget = (low: number, high: number) => (min > 0 ? low <= max && high >= min : high <= max);

  const range = place.priceRange;
  const rangeRate = range ? twdPerUnit[range.currency] : undefined;
  if (range && rangeRate !== undefined && (range.start !== undefined || range.end !== undefined)) {
    const low = (range.start ?? 0) * rangeRate;
    const high = range.end !== undefined ? range.end * rangeRate : Infinity;
    return inBudget(low, high) ? "fit" : "outside";
  }

  const level = place.priceLevel;
  if (!level) return "unknown";
  // Dinner's table: the pricier of the two meals this pool serves, so a
  // place judged in-budget is in budget for either.
  const estimate = estimateMealCost(currency, "dinner", level);
  const rate = currency ? twdPerUnit[currency] : undefined;
  if (estimate !== undefined && rate !== undefined) {
    const twd = estimate * rate;
    return inBudget(twd, twd) ? "fit" : "outside";
  }
  return FITTING_PRICE_LEVELS[budget].includes(level) ? "fit" : "outside";
}

/**
 * Lunch/dinner candidates in budget order — fitting first, unknown price
 * next, outside the budget last — keeping Google's popularity order within
 * each group. When fitting + unknown already cover `needed` meals, the
 * outside-budget ones are dropped so the LLM can't pick them.
 */
export function rankMainMealsByBudget<T extends Pick<PlaceCandidate, "priceRange" | "priceLevel">>(
  places: T[],
  budget: BudgetLevel | undefined,
  currency: string | undefined,
  twdPerUnit: Record<string, number>,
  needed: number
): T[] {
  if (!budget) return places;
  const withFit = places.map((place) => ({ place, fit: mainMealBudgetFit(place, budget, currency, twdPerUnit) }));
  const ranked = [...withFit].sort((a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit]);
  const acceptable = ranked.filter((r) => r.fit !== "outside");
  return (acceptable.length >= needed ? acceptable : ranked).map((r) => r.place);
}

/**
 * Per-person meal cost from Google's price range, in the itinerary's own
 * currency only (no conversion): the range midpoint, or the floor of an
 * open-ended range. Undefined when there's no usable range.
 */
export function estimateFromPriceRange(range: PriceRange | null | undefined, currency: string | undefined): number | undefined {
  if (!range || range.currency !== currency || range.start === undefined) return undefined;
  // Google writes "under ¥1,000" as ¥1–1,000; the midpoint (¥501) badly
  // undersells it, so treat a ¥1 floor as "up to the ceiling" — the
  // cautious figure for a budget.
  if (range.start <= 1 && range.end !== undefined) return Math.round(range.end);
  return Math.round(range.end !== undefined ? (range.start + range.end) / 2 : range.start);
}

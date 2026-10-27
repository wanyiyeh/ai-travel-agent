/**
 * A transit day's meals (ADR-0009): breakfast is still in the city being
 * left, the rest come after arriving. Without a breakfast from the departure
 * city, the slot stays empty for the traveler to pick — restructure doesn't
 * search that city's restaurants again just for it (#290).
 */
export function transitDayMeals(
  arrivalMeals: Record<string, unknown> | undefined,
  breakfastBeforeLeaving?: Record<string, unknown>
): Record<string, unknown> {
  const afterArriving = { ...(arrivalMeals ?? {}) };
  delete afterArriving.breakfast;
  return { ...(breakfastBeforeLeaving ? { breakfast: breakfastBeforeLeaving } : {}), ...afterArriving };
}

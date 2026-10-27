import type { MealType } from "@/types/itinerary";

/**
 * A meal the traveler deleted (ADR-0010): gone from `meals`, listed in
 * `skippedMeals` so the day card shows no empty slot for it, and dropped from
 * `mealPositions` so it no longer takes a place in the order. Shared by the
 * routes and the day card, so both make the same change.
 */

type DayLike = { meals?: object | null; mealPositions?: object | null; skippedMeals?: unknown };

const skippedOf = (day: DayLike): MealType[] => (Array.isArray(day.skippedMeals) ? (day.skippedMeals as MealType[]) : []);

const without = <T extends object>(record: T | null | undefined, key: string): T => {
  const copy = { ...(record ?? {}) } as Record<string, unknown>;
  delete copy[key];
  return copy as T;
};

export function skipMeal<D extends DayLike>(day: D, mealType: MealType): D {
  const skipped = skippedOf(day);
  return {
    ...day,
    meals: without(day.meals, mealType),
    mealPositions: without(day.mealPositions, mealType),
    skippedMeals: skipped.includes(mealType) ? skipped : [...skipped, mealType],
  };
}

/** Back as an empty slot to pick from; picking a place does this too. */
export function unskipMeal<D extends DayLike>(day: D, mealType: MealType): D {
  if (!skippedOf(day).includes(mealType)) return day;
  return { ...day, skippedMeals: skippedOf(day).filter((m) => m !== mealType) };
}

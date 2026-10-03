import type { MealType } from "@/types/itinerary";

export type TimeOfDay = "morning" | "afternoon" | "evening";

export type DayTimelineItem<S, M> =
  | { kind: "stop"; stop: S; stopIndex: number }
  | { kind: "meal"; mealType: MealType; meal: M };

// Which time-of-day header a meal sits under in the day card.
export const MEAL_TIME_OF_DAY: Record<MealType, TimeOfDay> = {
  breakfast: "morning",
  lunch: "afternoon",
  snack: "afternoon",
  dinner: "evening",
};

/**
 * One day's stops and meals as a single ordered list. Meals carry no time of
 * their own, so they're placed by rule: breakfast first, lunch just before
 * the first afternoon stop (or mid-day if no stop is tagged), snack and
 * dinner at the end. Shared by the day card and the map's route polyline so
 * both show the same order.
 *
 * Only meal types present as keys in `meals` are included — pass `null`
 * values to get placeholder slots for meals not picked yet.
 */
export function buildDayTimeline<S, M>(
  stops: readonly S[],
  meals: Partial<Record<MealType, M>>,
  getTimeOfDay: (stop: S) => TimeOfDay | undefined
): DayTimelineItem<S, M>[] {
  const mealItem = (mealType: MealType): DayTimelineItem<S, M>[] =>
    mealType in meals ? [{ kind: "meal", mealType, meal: meals[mealType] as M }] : [];

  const middle: DayTimelineItem<S, M>[] = stops.map((stop, stopIndex) => ({ kind: "stop", stop, stopIndex }));
  const lunch = mealItem("lunch");
  if (lunch.length > 0) {
    const firstAfternoon = stops.findIndex((s) => getTimeOfDay(s) === "afternoon");
    const at = firstAfternoon >= 0 ? firstAfternoon : Math.ceil(stops.length / 2);
    middle.splice(at, 0, ...lunch);
  }

  return [...mealItem("breakfast"), ...middle, ...mealItem("snack"), ...mealItem("dinner")];
}

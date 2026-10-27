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
  nightcap: "evening",
};

/**
 * The meals a traveler can drag within the day, in the order they must stay
 * in (ADR-0010). Breakfast always opens the day and the 小酌 always closes it.
 */
export const MOVABLE_MEALS = ["lunch", "snack", "dinner"] as const;
export type MovableMeal = (typeof MOVABLE_MEALS)[number];

/** How many of the day's stops come before each meal the traveler placed. */
export type MealPositions = Partial<Record<MovableMeal, number>>;

export function isMovableMeal(mealType: MealType): mealType is MovableMeal {
  return (MOVABLE_MEALS as readonly string[]).includes(mealType);
}

/**
 * One day's stops and meals as a single ordered list. Shared by the day card
 * and the map's route polyline so both show the same order.
 *
 * A meal the traveler placed goes where they put it (`positions`, ADR-0010).
 * Any other meal carries no time of its own and is placed by rule: breakfast
 * first, lunch just before the first afternoon stop (or mid-day if no stop is
 * tagged), snack and dinner at the end — or right before an evening show —
 * and the 小酌 last.
 *
 * Only meal types present as keys in `meals` are included — pass `null`
 * values to get placeholder slots for meals not picked yet.
 *
 * `indexOf` gives a stop's index among all of the day's stops, for a caller
 * passing only some of them (the map leaves out stops with no coordinates);
 * positions count all of them.
 */
export function buildDayTimeline<S, M>(
  stops: readonly S[],
  meals: Partial<Record<MealType, M>>,
  getTimeOfDay: (stop: S) => TimeOfDay | undefined,
  // A stop that dinner comes right before: an evening show, eaten near the
  // venue (fixedEvents.ts hasDinnerBefore) instead of after a 21:00 finish.
  dinnerBefore?: (stop: S) => boolean,
  { positions = {}, indexOf }: { positions?: MealPositions; indexOf?: (stop: S, listIndex: number) => number } = {}
): DayTimelineItem<S, M>[] {
  const mealItem = (mealType: MealType): DayTimelineItem<S, M>[] =>
    mealType in meals ? [{ kind: "meal", mealType, meal: meals[mealType] as M }] : [];
  const dayIndexAt = (listIndex: number) =>
    listIndex < stops.length ? (indexOf ? indexOf(stops[listIndex], listIndex) : listIndex) : Infinity;

  const firstAfternoon = stops.findIndex((s) => getTimeOfDay(s) === "afternoon");
  const show = dinnerBefore ? stops.findIndex((s) => dinnerBefore(s)) : -1;
  const ruled: Record<MovableMeal, number> = {
    lunch: dayIndexAt(firstAfternoon >= 0 ? firstAfternoon : Math.ceil(stops.length / 2)),
    snack: show >= 0 ? dayIndexAt(show) : Infinity,
    dinner: show >= 0 ? dayIndexAt(show) : Infinity,
  };
  // A meal left to the rule still can't pass a later meal the traveler placed,
  // and no meal comes before the one ahead of it in MOVABLE_MEALS.
  const effective = {} as Record<MovableMeal, number>;
  let floor = -Infinity;
  MOVABLE_MEALS.forEach((mealType, i) => {
    const laterPlaced = MOVABLE_MEALS.slice(i + 1).flatMap((m) => (positions[m] !== undefined ? [positions[m]] : []));
    const own = positions[mealType] ?? Math.min(ruled[mealType], ...laterPlaced);
    effective[mealType] = Math.max(own, floor);
    floor = effective[mealType];
  });
  const before = (mealType: MovableMeal) => effective[mealType];

  const placed = new Set<MovableMeal>();
  const mealsDueBy = (dayIndex: number) =>
    MOVABLE_MEALS.filter((m) => !placed.has(m) && before(m) <= dayIndex).flatMap((m) => {
      placed.add(m);
      return mealItem(m);
    });

  const middle = stops.flatMap((stop, listIndex): DayTimelineItem<S, M>[] => [
    ...mealsDueBy(dayIndexAt(listIndex)),
    { kind: "stop", stop, stopIndex: listIndex },
  ]);
  return [...mealItem("breakfast"), ...middle, ...mealsDueBy(Infinity), ...mealItem("nightcap")];
}

/**
 * Where each movable meal sits in a timeline, as the count of stops before
 * it — what gets saved once the traveler drags a meal (ADR-0010).
 */
export function mealPositionsOf<S, M>(timeline: readonly DayTimelineItem<S, M>[]): MealPositions {
  const positions: MealPositions = {};
  let stopsSoFar = 0;
  for (const item of timeline) {
    if (item.kind === "stop") stopsSoFar++;
    else if (isMovableMeal(item.mealType)) positions[item.mealType] = stopsSoFar;
  }
  return positions;
}

/** Whether a timeline keeps lunch, snack and dinner in their fixed order. */
export function mealsInOrder<S, M>(timeline: readonly DayTimelineItem<S, M>[]): boolean {
  const order = timeline.flatMap((item) => (item.kind === "meal" && isMovableMeal(item.mealType) ? [item.mealType] : []));
  return order.every((m, i) => i === 0 || MOVABLE_MEALS.indexOf(order[i - 1]) < MOVABLE_MEALS.indexOf(m));
}

/**
 * A stop's time of day on a day whose meals the traveler placed: before lunch
 * is morning, from dinner on is evening, between them afternoon. Undefined
 * when neither lunch nor dinner was placed — the caller's own rule applies.
 */
export function timeOfDayBetweenMeals(index: number, positions: MealPositions): TimeOfDay | undefined {
  const { lunch, dinner } = positions;
  if (lunch === undefined && dinner === undefined) return undefined;
  if (lunch !== undefined && index < lunch) return "morning";
  if (dinner !== undefined && index >= dinner) return "evening";
  return "afternoon";
}

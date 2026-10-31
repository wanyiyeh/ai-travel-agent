/**
 * Meals for the transit days a restructure leaves with empty slots (#295),
 * without searching restaurants again (#290). When a city goes in between
 * two others, the old transit day between them is replaced by two new ones,
 * and its meals went with it: its breakfast was in the city being left and
 * its lunch, snack and dinner in the city arrived at. They fit the new days
 * that leave from or arrive in those same cities, and the old day isn't on
 * the trip anymore, so nothing repeats.
 */

type Day = Record<string, unknown>;
type Meals = Record<string, unknown>;

const ARRIVAL_MEALS = ["lunch", "snack", "dinner", "nightcap"] as const;

function mealsOf(day: Day): Meals | undefined {
  return day.meals && typeof day.meals === "object" ? (day.meals as Meals) : undefined;
}

// A meal that is a booked event's belongs to that day's event, not to the move.
function movable(meal: unknown): meal is Record<string, unknown> {
  return Boolean(meal) && typeof meal === "object" && !(meal as Record<string, unknown>).fixedEvent;
}

/**
 * `finalDays` with each transit day's empty meal slots filled from the
 * transit days of `originalDays` that didn't make it into the trip: the
 * breakfast from one leaving the same city, the rest from one arriving in
 * the same city. Then a breakfast still missing comes from
 * `breakfastsBeforeLeaving`, picked from candidates searched anyway, by the
 * city being left. A meal the traveler deleted (skippedMeals) stays deleted,
 * and a filled one is never replaced.
 */
export function fillTransitMeals(
  finalDays: Day[],
  originalDays: Day[],
  breakfastsBeforeLeaving: ReadonlyMap<string, unknown> = new Map()
): Day[] {
  const finalIds = new Set(finalDays.map((d) => d.id));
  const replaced = originalDays.filter((d) => d.isTransitDay === true && !finalIds.has(d.id));
  const breakfastDonors = [...replaced];
  const arrivalDonors = [...replaced];
  const take = (donors: Day[], match: (d: Day) => boolean) => {
    const i = donors.findIndex(match);
    return i === -1 ? undefined : donors.splice(i, 1)[0];
  };

  return finalDays.map((day) => {
    const meals = mealsOf(day);
    if (day.isTransitDay !== true || !meals) return day;
    const skipped = new Set(Array.isArray(day.skippedMeals) ? day.skippedMeals : []);
    const open = (key: string) => !meals[key] && !skipped.has(key);
    const filled: Meals = { ...meals };

    if (open("breakfast")) {
      const donor = take(breakfastDonors, (d) => d.waypointCity === day.waypointCity && movable(mealsOf(d)?.breakfast));
      const breakfast = donor ? mealsOf(donor)!.breakfast : breakfastsBeforeLeaving.get(day.waypointCity as string);
      if (movable(breakfast)) filled.breakfast = breakfast;
    }
    if (ARRIVAL_MEALS.some(open)) {
      const donor = take(
        arrivalDonors,
        (d) => d.transitTo === day.transitTo && ARRIVAL_MEALS.some((key) => movable(mealsOf(d)?.[key]))
      );
      for (const key of ARRIVAL_MEALS) {
        const meal = donor ? mealsOf(donor)?.[key] : undefined;
        if (open(key) && movable(meal)) filled[key] = meal;
      }
    }
    return { ...day, meals: filled };
  });
}

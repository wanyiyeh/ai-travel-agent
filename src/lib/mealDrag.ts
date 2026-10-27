import { isMovableMeal, MOVABLE_MEALS, type MealPositions, type MovableMeal } from "@/lib/dayTimeline";

/**
 * Dragging within one day, where lunch, snack and dinner sit in the list
 * next to the stops (ADR-0010). Meals get their own drag ids so dnd-kit can
 * tell them from stops; what's on screen when the item is dropped is the
 * result, stops and meals alike.
 */

const PREFIX = "meal:";

export function mealDragId(dayId: string, mealType: MovableMeal): string {
  return `${PREFIX}${dayId}:${mealType}`;
}

export function parseMealDragId(id: string): { dayId: string; mealType: MovableMeal } | null {
  if (!id.startsWith(PREFIX)) return null;
  const rest = id.slice(PREFIX.length);
  const cut = rest.lastIndexOf(":");
  const mealType = rest.slice(cut + 1);
  if (cut <= 0 || !isMovableMeal(mealType as never)) return null;
  return { dayId: rest.slice(0, cut), mealType: mealType as MovableMeal };
}

export type DayDrop =
  | { ok: true; stopIds: string[]; mealPositions: MealPositions }
  /** The dragged meal would pass `blocking`, which has to stay on its side. */
  | { ok: false; moved: MovableMeal; blocking: MovableMeal };

/**
 * The day after dropping `activeId` onto `overId`, given the day's drag ids
 * in screen order. Null when either isn't in the list.
 */
export function dropInDay(sequence: readonly string[], activeId: string, overId: string): DayDrop | null {
  const from = sequence.indexOf(activeId);
  const to = sequence.indexOf(overId);
  if (from === -1 || to === -1) return null;

  const moved = [...sequence];
  moved.splice(to, 0, ...moved.splice(from, 1));

  const meals = moved.flatMap((id) => {
    const meal = parseMealDragId(id);
    return meal ? [meal.mealType] : [];
  });
  const outOfOrder = meals.findIndex((m, i) => i > 0 && MOVABLE_MEALS.indexOf(meals[i - 1]) > MOVABLE_MEALS.indexOf(m));
  if (outOfOrder !== -1) {
    const pair = [meals[outOfOrder - 1], meals[outOfOrder]];
    const active = parseMealDragId(activeId)?.mealType;
    // Name the meal that was in the way, not the one the traveler is holding.
    const blocking = pair.find((m) => m !== active) ?? pair[0];
    return { ok: false, moved: active ?? pair[1], blocking };
  }

  const stopIds: string[] = [];
  const mealPositions: MealPositions = {};
  for (const id of moved) {
    const meal = parseMealDragId(id);
    if (meal) mealPositions[meal.mealType] = stopIds.length;
    else stopIds.push(id);
  }
  return { ok: true, stopIds, mealPositions };
}

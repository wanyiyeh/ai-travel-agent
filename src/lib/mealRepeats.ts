import type { MealType } from "@/types/itinerary";

// Long stays repeat a restaurant once the candidate pool runs out
// (mealLodgingPicks.ts). These helpers make repeats visible so a traveler
// can swap one out with 換一家.

export const MEAL_LABELS: Record<MealType, string> = { breakfast: "早餐", lunch: "午餐", snack: "點心", dinner: "晚餐" };

// The order meals appear in a day's timeline (lib/dayTimeline.ts).
const TIMELINE_ORDER: MealType[] = ["breakfast", "lunch", "snack", "dinner"];

// Stored days are loosely typed (itinerary JSON), so read only what's needed.
type DayLike = { day?: unknown; meals?: unknown };

export type MealSlot = { day: number; mealType: MealType };

function placeIdOf(meals: unknown, mealType: MealType): string | undefined {
  const meal = (meals as Record<string, { placeId?: unknown } | undefined> | undefined)?.[mealType];
  return typeof meal?.placeId === "string" ? meal.placeId : undefined;
}

/** Every planned meal slot, in timeline order, with the place it goes to. */
function slotsInOrder(days: DayLike[]): Array<MealSlot & { placeId: string }> {
  const slots: Array<MealSlot & { placeId: string }> = [];
  for (const d of days) {
    if (typeof d.day !== "number") continue;
    for (const mealType of TIMELINE_ORDER) {
      const placeId = placeIdOf(d.meals, mealType);
      if (placeId) slots.push({ day: d.day, mealType, placeId });
    }
  }
  return slots.sort((a, b) => a.day - b.day);
}

export const slotKey = (day: number, mealType: MealType) => `${day}:${mealType}`;

/**
 * For each meal slot whose place already came earlier in the trip: which
 * visit this is (2 = second time) and the day of the visit before it. Keyed
 * by slotKey. Meals without a placeId (invented names) can't be compared and
 * are skipped.
 */
export function findRepeatedMeals(days: DayLike[]): Map<string, { visit: number; previousDay: number }> {
  const seen = new Map<string, number[]>();
  const repeats = new Map<string, { visit: number; previousDay: number }>();
  for (const slot of slotsInOrder(days)) {
    const visits = seen.get(slot.placeId) ?? [];
    if (visits.length > 0) {
      repeats.set(slotKey(slot.day, slot.mealType), { visit: visits.length + 1, previousDay: visits[visits.length - 1] });
    }
    visits.push(slot.day);
    seen.set(slot.placeId, visits);
  }
  return repeats;
}

/**
 * Where each place is already planned, for labelling 換一家 candidates —
 * leaving out the slot being swapped, since replacing it with itself isn't a
 * repeat.
 */
export function plannedSlotsByPlace(days: DayLike[], excluding: MealSlot): Map<string, MealSlot[]> {
  const byPlace = new Map<string, MealSlot[]>();
  for (const { placeId, day, mealType } of slotsInOrder(days)) {
    if (day === excluding.day && mealType === excluding.mealType) continue;
    byPlace.set(placeId, [...(byPlace.get(placeId) ?? []), { day, mealType }]);
  }
  return byPlace;
}

/** "第 3 天晚餐已安排" — the first planned slot, plus a count if there are more. */
export function plannedLabel(slots: MealSlot[]): string {
  const [first] = slots;
  const more = slots.length > 1 ? `等 ${slots.length} 餐` : "";
  return `第 ${first.day} 天${MEAL_LABELS[first.mealType]}${more}已安排`;
}

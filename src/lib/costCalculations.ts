import type { Stop, DayMeals, Day } from "@/types/itinerary";

// Single source of truth for summing a day's estimated_cost fields — used by
// both the editable view (EditableItineraryCard) and the read-only view
// (ViewContent) so their cost summaries can't drift out of sync.

export function calculateStopsCost(stops: Stop[]): number {
  return stops.reduce((total, s) => total + (s.estimated_cost ?? 0), 0);
}

export function calculateMealsCost(meals?: DayMeals): number {
  return (
    (meals?.breakfast?.estimated_cost ?? 0) +
    (meals?.lunch?.estimated_cost ?? 0) +
    (meals?.dinner?.estimated_cost ?? 0) +
    (meals?.snack?.estimated_cost ?? 0)
  );
}

export function calculateDayTotalCost(day: Pick<Day, "stops" | "meals" | "accommodation">): number {
  return (
    calculateStopsCost(day.stops) +
    calculateMealsCost(day.meals) +
    (day.accommodation?.estimated_cost ?? 0)
  );
}

export function hasAnyStopCost(days: Pick<Day, "stops">[]): boolean {
  return days.some((d) => d.stops.some((s) => s.estimated_cost !== undefined));
}

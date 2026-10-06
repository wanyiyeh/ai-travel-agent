import type { BudgetLevel } from "@/lib/fetchCityRestaurants";
import { MAIN_MEAL_BUDGET_TWD } from "@/lib/mealBudget";
import { isLuxuryLodging } from "@/lib/lodgingTiers";
import { mapPlaceTypeToCategory } from "@/lib/scheduler/mapPlaceTypeToCategory";

// Measures one generated itinerary for scripts/eval-form-fidelity.ts — how
// much each home-form choice actually changed the trip. Pure: Google types
// and exchange rates are passed in, so it's unit-testable without API calls.

type Rec = Record<string, unknown>;

export type EvalContext = {
  /** placeId -> Google types, from the Nearby candidate cache. */
  placeTypes: Map<string, string[]>;
  /** NT$ per unit of each currency (exchangeRate.ts getTwdRates). */
  twdPerUnit: Record<string, number>;
  currency: string;
  budget?: BudgetLevel;
};

export type ItineraryMetrics = {
  sightseeingDays: number;
  stopsPerDay: number;
  avgStayMinutes: number;
  /** Sightseeing days that got no stops at all. */
  emptySightseeingDays: number;
  /** Share of sightseeing stops per duration category (museum, park, ...), "other" when unknown. */
  categoryShare: Record<string, number>;
  mainMeals: number;
  avgMainMealTwd: number | null;
  /** Share of priced lunches/dinners inside the budget's NT$ range; null without a budget or prices. */
  mainMealsWithinBudget: number | null;
  /** Share of lunches/dinners whose primary type is vegetarian/vegan. */
  vegetarianShare: number;
  /** Lunches/dinners centred on meat or seafood (steak house, seafood, sushi). */
  meatOrSeafoodMeals: number;
  lodging: { name: string; hostel: boolean; luxury: boolean }[];
  /** Days (other than the return day) with fewer meals than expected — 3 on a transit day, else 4. */
  daysMissingMeals: number;
  /** 1 − distinct places / meals, over meals that have a placeId. */
  mealRepeatRate: number;
  /** The same place on the same day or the next. */
  adjacentRepeats: number;
  /** Meals without a placeId — names the LLM made up. */
  inventedMeals: number;
  /** Cities in order, consecutive duplicates merged. */
  cities: string[];
};

const MEAL_KEYS = ["breakfast", "lunch", "snack", "dinner"] as const;
const VEGETARIAN_TYPES = new Set(["vegetarian_restaurant", "vegan_restaurant"]);
const MEAT_OR_SEAFOOD_TYPES = new Set(["steak_house", "seafood_restaurant", "sushi_restaurant"]);

const asRecords = (value: unknown): Rec[] => (Array.isArray(value) ? (value as Rec[]) : []);
const num = (value: unknown) => (typeof value === "number" ? value : undefined);
const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function measureItinerary(days: Rec[], ctx: EvalContext): ItineraryMetrics {
  const lastIdx = days.length - 1;
  const typesOf = (placeId: unknown) => (str(placeId) ? ctx.placeTypes.get(placeId as string) : undefined);

  // --- stops ---
  const sightseeing = days.filter((d, i) => i !== lastIdx && d.isTransitDay !== true);
  const stops = sightseeing.flatMap((d) => asRecords(d.stops));
  const categories = new Map<string, number>();
  for (const stop of stops) {
    const types = typesOf(stop.placeId);
    const category = (types && mapPlaceTypeToCategory(types)) ?? "other";
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  const categoryShare = Object.fromEntries([...categories].map(([k, n]) => [k, n / Math.max(1, stops.length)]));

  // --- meals ---
  const mainMeals: Rec[] = [];
  const visits: Array<{ placeId: string; day: number }> = [];
  let inventedMeals = 0;
  let daysMissingMeals = 0;
  days.forEach((d, i) => {
    const meals = (d.meals ?? {}) as Rec;
    const present = MEAL_KEYS.filter((k) => meals[k] && typeof meals[k] === "object");
    const expected = d.isTransitDay === true ? 3 : 4;
    if (i !== lastIdx && present.length < expected) daysMissingMeals++;
    for (const key of present) {
      const meal = meals[key] as Rec;
      const placeId = str(meal.placeId);
      if (!placeId) inventedMeals++;
      else visits.push({ placeId, day: i });
      if (key === "lunch" || key === "dinner") mainMeals.push(meal);
    }
  });

  const rate = ctx.twdPerUnit[ctx.currency];
  const pricedTwd = mainMeals
    .map((m) => num(m.estimated_cost))
    .filter((c): c is number => c !== undefined && rate !== undefined)
    .map((c) => c * rate!);
  let mainMealsWithinBudget: number | null = null;
  if (ctx.budget && pricedTwd.length > 0) {
    const { min, max } = MAIN_MEAL_BUDGET_TWD[ctx.budget];
    mainMealsWithinBudget = pricedTwd.filter((twd) => twd >= min && twd <= max).length / pricedTwd.length;
  }

  const primaryOf = (meal: Rec) => typesOf(meal.placeId)?.[0];
  const vegetarian = mainMeals.filter((m) => VEGETARIAN_TYPES.has(primaryOf(m) ?? "")).length;
  const meatOrSeafood = mainMeals.filter((m) => MEAT_OR_SEAFOOD_TYPES.has(primaryOf(m) ?? "")).length;

  const lastDayOf = new Map<string, number>();
  let adjacentRepeats = 0;
  for (const { placeId, day } of visits) {
    const last = lastDayOf.get(placeId);
    if (last !== undefined && day - last < 2) adjacentRepeats++;
    lastDayOf.set(placeId, day);
  }
  const mealRepeatRate = visits.length ? 1 - new Set(visits.map((v) => v.placeId)).size / visits.length : 0;

  // --- lodging ---
  const lodgingSeen = new Set<string>();
  const lodging: ItineraryMetrics["lodging"] = [];
  for (const d of days) {
    const acc = d.accommodation as Rec | null | undefined;
    const name = str(acc?.name);
    if (!acc || !name || lodgingSeen.has(name)) continue;
    lodgingSeen.add(name);
    const types = typesOf(acc.placeId);
    lodging.push({ name, hostel: types?.[0] === "hostel", luxury: isLuxuryLodging({ name, types }) });
  }

  // --- cities ---
  const cities: string[] = [];
  for (const d of days) {
    const city = str(d.waypointCity);
    if (city && cities[cities.length - 1] !== city) cities.push(city);
  }

  return {
    sightseeingDays: sightseeing.length,
    stopsPerDay: sightseeing.length ? stops.length / sightseeing.length : 0,
    avgStayMinutes: avg(stops.map((s) => num(s.duration_minutes) ?? 0)),
    emptySightseeingDays: sightseeing.filter((d) => asRecords(d.stops).length === 0).length,
    categoryShare,
    mainMeals: mainMeals.length,
    avgMainMealTwd: pricedTwd.length ? avg(pricedTwd) : null,
    mainMealsWithinBudget,
    vegetarianShare: mainMeals.length ? vegetarian / mainMeals.length : 0,
    meatOrSeafoodMeals: meatOrSeafood,
    lodging,
    daysMissingMeals,
    mealRepeatRate,
    adjacentRepeats,
    inventedMeals,
    cities,
  };
}

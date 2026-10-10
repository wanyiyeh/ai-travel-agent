import type { BudgetLevel } from "@/lib/fetchCityRestaurants";
import { MAIN_MEAL_BUDGET_TWD } from "@/lib/mealBudget";
import { isBudgetLodging, isLuxuryLodging } from "@/lib/lodgingTiers";
import { mapPlaceTypeToCategory } from "@/lib/scheduler/mapPlaceTypeToCategory";
import { exposureOf, isBarStreet } from "@/lib/indoorOutdoor";
import { haversineKm } from "@/lib/geo";

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
  /** Share of sightseeing stops that are outdoor (indoorOutdoor.ts). */
  outdoorShare: number;
  /** Legs between sightseeing stops shown as a taxi ride (「搭計程車」). */
  taxiLegs: number;
  /** Every leg in the trip by how it's travelled, from its label. */
  legModes: { walk: number; transit: number; drive: number; taxi: number };
  /** The trip's very first and very last stop — a self-driver's car pickup and return. */
  tripEnds: { first?: string; last?: string };
  /** 季節限定 days (seasonalHighlights.ts): the title and every stop's name. */
  seasonalDays: { day: number; title: string; stops: string[]; eveningStops: number }[];
  /** Days out of the city (suburbTrips.ts): the title and where the first stop is. */
  suburbDays: { day: number; title: string; stops: number; first?: { name: string; lat?: number; lng?: number } }[];
  /** Where each 固定行程 ended up: a stop (with its position in the day) or the meal it replaced. */
  fixedEvents: { day: number; name: string; as: string; lastStop?: boolean; dinnerKm?: number; city?: string }[];
  mainMeals: number;
  avgMainMealTwd: number | null;
  /** Share of priced lunches/dinners inside the budget's NT$ range; null without a budget or prices. */
  mainMealsWithinBudget: number | null;
  /** Share of lunches/dinners whose primary type is vegetarian/vegan. */
  vegetarianShare: number;
  /** Lunches/dinners centred on meat or seafood (steak house, seafood, sushi). */
  meatOrSeafoodMeals: number;
  /** budgetTier: hostel, guest house, B&B, budget inn or motel (lodgingTiers.ts). */
  lodging: { name: string; budgetTier: boolean; luxury: boolean; hostel: boolean }[];
  /** Days (other than the return day) with fewer meals than expected — 3 on a transit day, else 4. */
  daysMissingMeals: number;
  /** 1 − distinct places / meals, over meals that have a placeId. */
  mealRepeatRate: number;
  /** The same place on the same day or the next. */
  adjacentRepeats: number;
  /** Meals without a placeId — names the LLM made up. */
  inventedMeals: number;
  /** Meals at a hotel (Google types include lodging), e.g. Hotel sardonyx ueno as a dinner — should be none. */
  mealsAtLodging: string[];
  /** A transit day's stops that go back to a place already seen in the city it leaves, by name (「小樽運河散步」). */
  transitRepeats: string[];
  /** Stops on any day at a bar street (indoorOutdoor.ts isBarStreet), e.g. 新宿黃金街 — should be none. */
  barStreetStops: string[];
  /** Stops and meals at a real place with no description (bookings aside) — missingCopy.ts should leave none. */
  missingDescriptions: string[];
  /** Cities in order, consecutive duplicates merged. */
  cities: string[];
  /** Where each night is spent, consecutive nights in one city merged (a transit day's night is in the city it goes to). */
  nightStays: { city: string; nights: number }[];
  /** Each sightseeing day's title, e.g. 「東京 文化巡禮」 (dayThemes.ts). */
  dayTitles: string[];
  /** Each sightseeing day's weather line, 「日落約 16:28」 (dayConditions.ts); "" without one. */
  weatherNotes: string[];
  /** Sightseeing days that get dark before 17:00 with an outdoor stop after an indoor one. */
  outdoorAfterDarkDays: number;
  /** Each day's snack in order (days without one skipped), with Google's primary type. */
  snacks: { name: string; primaryType?: string }[];
  /** Each night's 小酌 except the return day's, null where there is none. */
  nightcaps: ({ name: string; primaryType?: string } | null)[];
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
    lodging.push({
      name,
      budgetTier: isBudgetLodging({ types }),
      luxury: isLuxuryLodging({ name, types }),
      hostel: Boolean(types?.includes("hostel")),
    });
  }

  // --- cities ---
  const cities: string[] = [];
  for (const d of days) {
    const city = str(d.waypointCity);
    if (city && cities[cities.length - 1] !== city) cities.push(city);
  }
  const nightStays: ItineraryMetrics["nightStays"] = [];
  for (const d of days.slice(0, lastIdx)) {
    const city = str(d.isTransitDay ? d.transitTo : d.waypointCity);
    if (!city) continue;
    const last = nightStays[nightStays.length - 1];
    if (last?.city === city) last.nights++;
    else nightStays.push({ city, nights: 1 });
  }

  return {
    sightseeingDays: sightseeing.length,
    stopsPerDay: sightseeing.length ? stops.length / sightseeing.length : 0,
    avgStayMinutes: avg(stops.map((s) => num(s.duration_minutes) ?? 0)),
    emptySightseeingDays: sightseeing.filter((d) => asRecords(d.stops).length === 0).length,
    categoryShare,
    outdoorShare: stops.filter((s) => exposureOf(typesOf(s.placeId)) === "outdoor").length / Math.max(1, stops.length),
    taxiLegs: stops.filter((s) => str(s.transport_from_prev)?.includes("計程車")).length,
    legModes: (() => {
      const labels = days.flatMap((d) => asRecords(d.stops)).map((s) => str(s.transport_from_prev) ?? "");
      return {
        walk: labels.filter((l) => l.startsWith("步行")).length,
        transit: labels.filter((l) => l.startsWith("搭乘大眾運輸")).length,
        drive: labels.filter((l) => l.startsWith("開車")).length,
        taxi: labels.filter((l) => l.startsWith("搭計程車")).length,
      };
    })(),
    tripEnds: {
      first: str(asRecords(days[0]?.stops)[0]?.name),
      last: str(asRecords(days[lastIdx]?.stops).at(-1)?.name),
    },
    seasonalDays: days.flatMap((d, i) => {
      const title = str(d.theme) ?? "";
      if (!title.includes("季節限定")) return [];
      const stops = asRecords(d.stops);
      return [{ day: i + 1, title, stops: stops.map((s) => str(s.name) ?? ""), eveningStops: stops.filter((s) => s.time_of_day === "evening").length }];
    }),
    suburbDays: days.flatMap((d, i) => {
      const title = str(d.theme) ?? "";
      if (!/一日遊|半日遊/.test(title)) return [];
      const stops = asRecords(d.stops);
      const first = stops[0];
      return [{
        day: i + 1,
        title,
        stops: stops.length,
        ...(first ? { first: { name: str(first.name) ?? "", lat: num(first.lat), lng: num(first.lng) } } : {}),
      }];
    }),
    fixedEvents: days.flatMap((d, i) => {
      const dayStops = asRecords(d.stops);
      const meals = (d.meals ?? {}) as Rec;
      const dinner = meals.dinner as Rec | undefined;
      // How far the day's dinner is from the event — dinner before a show should be near the venue.
      const dinnerKm = (s: Rec) => {
        const [a, b, c, e] = [num(s.lat), num(s.lng), num(dinner?.lat), num(dinner?.lng)];
        return a !== undefined && b !== undefined && c !== undefined && e !== undefined
          ? Math.round(haversineKm(a, b, c, e) * 10) / 10
          : undefined;
      };
      // The city the traveler is in that day — on a transit day, the one being reached.
      const city = str(d.isTransitDay === true ? d.transitTo : d.waypointCity);
      const asStops = dayStops.flatMap((s, k) =>
        s.fixedEvent
          ? [{
              day: i + 1,
              name: str(s.name) ?? "",
              as: "stop",
              lastStop: k === dayStops.length - 1,
              ...(dinnerKm(s) !== undefined ? { dinnerKm: dinnerKm(s) } : {}),
              ...(city ? { city } : {}),
            }]
          : []
      );
      const asMeals = Object.entries(meals).flatMap(([key, m]) =>
        m && typeof m === "object" && (m as Rec).fixedEvent ? [{ day: i + 1, name: str((m as Rec).name) ?? "", as: key }] : []
      );
      return [...asStops, ...asMeals];
    }),
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
    mealsAtLodging: days.flatMap((d) =>
      MEAL_KEYS.map((k) => ((d.meals ?? {}) as Rec)[k])
        .filter((m): m is Rec => Boolean(m) && typeof m === "object")
        .filter((m) => typesOf(m.placeId)?.includes("lodging"))
        .map((m) => str(m.name) ?? "")
    ),
    transitRepeats: days.flatMap((d, i) => {
      if (d.isTransitDay !== true) return [];
      const from = str(d.waypointCity);
      const seen = days
        .slice(0, i)
        .filter((x) => x.waypointCity === from || x.transitTo === from)
        .flatMap((x) => asRecords(x.stops).map((s) => str(s.name) ?? ""))
        .filter((n) => n.length >= 2);
      return asRecords(d.stops)
        .map((s) => str(s.name) ?? "")
        .filter((n) => n.length >= 2 && seen.some((v) => n.includes(v) || v.includes(n)));
    }),
    barStreetStops: days.flatMap((d) => asRecords(d.stops).filter((s) => isBarStreet(typesOf(s.placeId))).map((s) => str(s.name) ?? "")),
    missingDescriptions: days.flatMap((d) => {
      const meals = (d.meals ?? {}) as Rec;
      const items = [...asRecords(d.stops), ...MEAL_KEYS.map((k) => meals[k]).filter((m): m is Rec => Boolean(m) && typeof m === "object")];
      return items
        .filter((x) => str(x.placeId) && !x.fixedEvent && !(str(x.description) ?? "").trim())
        .map((x) => str(x.name) ?? "");
    }),
    cities,
    nightStays,
    dayTitles: sightseeing.map((d) => str(d.theme) ?? ""),
    weatherNotes: sightseeing.map((d) => str(d.weatherNote) ?? ""),
    outdoorAfterDarkDays: sightseeing.filter((d) => {
      const sunset = /日落約 (\d+):(\d+)/.exec(str(d.weatherNote) ?? "");
      if (!sunset || Number(sunset[1]) * 60 + Number(sunset[2]) >= 17 * 60) return false;
      const order = asRecords(d.stops).map((s) => exposureOf(typesOf(s.placeId)));
      const firstIndoor = order.indexOf("indoor");
      return firstIndoor >= 0 && order.lastIndexOf("outdoor") > firstIndoor;
    }).length,
    snacks: days.flatMap((d) => {
      const snack = ((d.meals ?? {}) as Rec).snack as Rec | undefined;
      const name = str(snack?.name);
      return name ? [{ name, primaryType: typesOf(snack?.placeId)?.[0] }] : [];
    }),
    nightcaps: days.slice(0, lastIdx).map((d) => {
      const nightcap = ((d.meals ?? {}) as Rec).nightcap as Rec | undefined;
      const name = str(nightcap?.name);
      return name ? { name, primaryType: typesOf(nightcap?.placeId)?.[0] } : null;
    }),
  };
}

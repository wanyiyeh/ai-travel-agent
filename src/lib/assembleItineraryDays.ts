import type { FlightInfo, TripPreferences } from "@/lib/schemas";
import type { BudgetLevel } from "@/lib/fetchCityRestaurants";
import { planTrip, type TripPlan } from "@/lib/tripPlan";
import {
  generateThemedDayStops,
  generateTransitDayStops,
  generateDepartureDayStops,
  generateMealsAndAccommodation,
  mealPreferencesOf,
  parseTimeString,
} from "@/lib/itineraryCityGen";
import { parsePreferenceIntent } from "@/lib/preferenceIntent";
import { mergePreferenceIntent } from "@/lib/mergePreferenceIntent";
import { computeArrivalDayStartMinute } from "@/lib/scheduler/arrivalDayStart";
import { THEMES } from "@/lib/dayThemes";

const DEFAULT_ARRIVAL_MINUTE_FALLBACK = 14 * 60;

export type AssembledItinerary = {
  title: string;
  currency: string;
  days: Array<Record<string, unknown>>;
};

// Emitted as each piece of the itinerary becomes available, so a caller (the
// SSE route, Phase 5(c)) can stream progress instead of waiting for the
// whole trip. Purely additive — assembleItineraryDays' return value is
// unchanged, onProgress is optional.
export type AssembleProgressEvent =
  | { type: "plan"; title: string; currency: string; cities: TripPlan["cities"] }
  | { type: "day"; day: Record<string, unknown> };

function extractPlaceIds(stops: Array<Record<string, unknown>>): string[] {
  return stops
    .map((s) => (typeof s.placeId === "string" ? s.placeId : undefined))
    .filter((id): id is string => !!id);
}

// A lodging picked from real candidates carries coordinates; one the LLM
// invented (no candidates) doesn't, and the generators then fall back to the
// city center.
function locationOf(accommodation: Record<string, unknown> | undefined): { lat: number; lng: number } | undefined {
  const lat = accommodation?.lat;
  const lng = accommodation?.lng;
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : undefined;
}

function withoutBreakfast(meals: Record<string, unknown> | undefined): Record<string, unknown> {
  const rest = { ...(meals ?? {}) };
  delete rest.breakfast;
  return rest;
}

// The return day ends at the airport, so no 小酌 after dinner.
function withoutNightcap(meals: Record<string, unknown> | undefined): Record<string, unknown> {
  const rest = { ...(meals ?? {}) };
  delete rest.nightcap;
  return rest;
}

const emptyMealsAndAccommodation = (nights: number) => ({
  accommodation: {} as Record<string, unknown>,
  mealsByDay: Array.from({ length: nights }, () => ({}) as Record<string, unknown>),
});

/**
 * Plan/hybrid-rule-engine-scheduling.md Phase 5(b)/(c): wires planTrip()
 * (Phase 5(a)) together with the already-shipped, self-fallback-guaranteed
 * generateDayStops/generateTransitDayStops (Phase 3/4) plus
 * generateDepartureDayStops (Phase 5(a)) into one from-scratch full
 * itinerary. Returns null only when planTrip() itself fails (no fallback
 * exists for that specific piece yet — the route caller decides whether to
 * fall back to the old full-LLM flow); every other generation call here
 * already guarantees a usable result on its own (including
 * generateMealsAndAccommodation, wrapped in .catch() below — it's the one
 * call in this pipeline that doesn't already guarantee that itself), so
 * there's nothing else this function needs to retry or catch.
 */
export async function assembleItineraryDays(
  flightInfo: FlightInfo,
  prompt: string | undefined,
  preferences: TripPreferences | undefined,
  model: string,
  onProgress?: (event: AssembleProgressEvent) => void
): Promise<AssembledItinerary | null> {
  // The free-text parse only feeds per-day scheduling, not planTrip, so it
  // runs alongside it instead of adding a round trip. It never throws (falls
  // back to a neutral intent), so it can't fail the whole plan.
  const [plan, parsedIntent] = await Promise.all([
    planTrip(flightInfo, prompt, preferences, model),
    parsePreferenceIntent(prompt ?? "", model),
  ]);
  if (!plan) return null;
  onProgress?.({ type: "plan", title: plan.title, currency: plan.currency, cities: plan.cities });

  const budget = preferences?.budget as BudgetLevel | undefined;
  const preferenceIntent = mergePreferenceIntent(preferences, parsedIntent);
  const mealPreferences = mealPreferencesOf(preferenceIntent, preferences?.drinks);

  const arrivalMinute = flightInfo.arrivalTime
    ? parseTimeString(flightInfo.arrivalTime, DEFAULT_ARRIVAL_MINUTE_FALLBACK)
    : undefined;
  const arrivalDayStartMinute = computeArrivalDayStartMinute(arrivalMinute);

  const days: Array<Record<string, unknown>> = [];
  let nextDayNumber = 1;
  function pushDay(day: Record<string, unknown>) {
    const numbered = { ...day, day: nextDayNumber++ };
    days.push(numbered);
    onProgress?.({ type: "day", day: numbered });
  }

  const usedPlaceIdsByCity = new Map<string, Set<string>>();
  // Sightseeing days so far, so the theme rotation runs across the whole trip.
  let themedDaysSoFar = 0;
  for (let cityIdx = 0; cityIdx < plan.cities.length; cityIdx++) {
    const city = plan.cities[cityIdx];
    const isFirst = cityIdx === 0;
    const isLast = cityIdx === plan.cities.length - 1;

    // Places already used in this city this request — without tracking this,
    // the transit-arrival stops, sightseeing days, and (for the last city)
    // departure stops each independently query the same small
    // tourist_attraction candidate pool and can suggest the same top-rated
    // landmark more than once in the same trip (caught in manual verification:
    // Kyoto's transit-arrival stops and its sightseeing day both picked
    // 清水寺/伏見稻荷大社; Osaka's transit-arrival and departure stops were
    // identical). Keyed by city, not by block: a round-trip loop visits the
    // arrival city twice (札幌 → 富良野 → 札幌).
    const usedPlaceIds = usedPlaceIdsByCity.get(city.name) ?? new Set<string>();
    usedPlaceIdsByCity.set(city.name, usedPlaceIds);

    const sightseeingCount = city.days - (isFirst ? 0 : 1);
    // Days that need meals from this city: its sightseeing days, the return
    // day for the last city, and — for every city after the first — the
    // transit day into it (lunch, dinner and snack happen after arriving).
    // Transit days used to get no meals at all; a round-trip loop has
    // several, which left half a week without restaurants.
    const transitMealDays = isFirst ? 0 : 1;
    const mealDays = transitMealDays + sightseeingCount + (isLast ? 1 : 0);

    // Meals/accommodation don't depend on which attractions get picked, so
    // this can run alongside the transit day's generation below rather than
    // waiting on it. Sightseeing does wait on it: stops are scored by
    // distance from the chosen lodging. Unlike generateDayStops/generateTransitDayStops/
    // generateDepartureDayStops, this call has no try/catch of its own — an
    // API error or malformed response would otherwise throw straight through
    // assembleItineraryDays, breaking its "never throws except when planTrip
    // fails" contract. restructure/route.ts already wraps every one of its
    // own call sites with this same degrade-to-empty pattern.
    const mealsAndAccommodationPromise = generateMealsAndAccommodation(city.name, mealDays, plan.currency, budget, mealPreferences).catch(
      () => emptyMealsAndAccommodation(mealDays)
    );

    if (!isFirst) {
      const prevCity = plan.cities[cityIdx - 1];
      const [transitStops, mealsAndAccommodation] = await Promise.all([
        generateTransitDayStops(prevCity.name, city.name, plan.currency, budget, preferenceIntent, Array.from(usedPlaceIds)),
        mealsAndAccommodationPromise,
      ]);
      for (const placeId of extractPlaceIds(transitStops)) usedPlaceIds.add(placeId);

      const hasAccommodation = Object.keys(mealsAndAccommodation.accommodation).length > 0;
      pushDay({
        id: crypto.randomUUID(),
        theme: `移動日：前往${city.name}`,
        isTransitDay: true,
        transitTo: city.name,
        waypointCity: prevCity.name,
        stops: transitStops,
        // The transit day's own night is spent in the destination city —
        // same accommodation as the sightseeing days that follow it.
        accommodation: hasAccommodation ? mealsAndAccommodation.accommodation : undefined,
        // Breakfast is still in the city being left — usually the transit
        // plan's own station breakfast — so only the meals after arriving.
        meals: withoutBreakfast(mealsAndAccommodation.mealsByDay[0]),
      });
    }

    const mealsAndAccommodation = await mealsAndAccommodationPromise;
    const hasAccommodation = Object.keys(mealsAndAccommodation.accommodation).length > 0;
    const accommodation = hasAccommodation ? mealsAndAccommodation.accommodation : undefined;
    const lodging = locationOf(accommodation);

    const { stopsByDay: sightseeingStops, themeByDay } =
      sightseeingCount > 0
        ? await generateThemedDayStops(
            city.name,
            sightseeingCount,
            plan.currency,
            Array.from(usedPlaceIds),
            budget,
            preferenceIntent,
            isFirst ? arrivalDayStartMinute : undefined,
            lodging,
            themedDaysSoFar
          )
        : { stopsByDay: [], themeByDay: [] };
    themedDaysSoFar += sightseeingCount;
    for (const dayStops of sightseeingStops) {
      for (const placeId of extractPlaceIds(dayStops)) usedPlaceIds.add(placeId);
    }

    for (let i = 0; i < sightseeingStops.length; i++) {
      const dayTheme = themeByDay[i];
      pushDay({
        id: crypto.randomUUID(),
        theme: `${city.name} ${dayTheme ? THEMES[dayTheme].label : "探索"}`,
        waypointCity: city.name,
        stops: sightseeingStops[i],
        accommodation,
        meals: mealsAndAccommodation.mealsByDay[transitMealDays + i] ?? {},
      });
    }

    if (isLast) {
      const departureStops = await generateDepartureDayStops(
        city.name,
        plan.currency,
        flightInfo.returnDepartureTime,
        budget,
        preferenceIntent,
        Array.from(usedPlaceIds),
        lodging
      );
      pushDay({
        id: crypto.randomUUID(),
        theme: "返程日",
        waypointCity: city.name,
        stops: departureStops,
        // The last day is a departure day — no accommodation, matching the
        // existing big-prompt rule (itineraryGen.ts buildSystemPrompt rule 7).
        accommodation: null,
        meals: withoutNightcap(mealsAndAccommodation.mealsByDay[transitMealDays + sightseeingCount]),
      });
    }
  }

  return {
    title: plan.title,
    currency: plan.currency,
    days,
  };
}

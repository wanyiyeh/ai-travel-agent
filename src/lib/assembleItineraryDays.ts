import type { FlightInfo, TripPreferences } from "@/lib/schemas";
import type { BudgetLevel } from "@/lib/fetchCityRestaurants";
import { planTrip } from "@/lib/tripPlan";
import {
  generateDayStops,
  generateTransitDayStops,
  generateDepartureDayStops,
  generateMealsAndAccommodation,
  parseTimeString,
} from "@/lib/itineraryCityGen";
import { NEUTRAL_PREFERENCE_INTENT } from "@/lib/schemas";
import { computeArrivalDayStartMinute } from "@/lib/scheduler/arrivalDayStart";

const DEFAULT_ARRIVAL_MINUTE_FALLBACK = 14 * 60;

export type AssembledItinerary = {
  title: string;
  currency: string;
  days: Array<Record<string, unknown>>;
};

function extractPlaceIds(stops: Array<Record<string, unknown>>): string[] {
  return stops
    .map((s) => (typeof s.placeId === "string" ? s.placeId : undefined))
    .filter((id): id is string => !!id);
}

/**
 * Plan/hybrid-rule-engine-scheduling.md Phase 5(b): wires planTrip() (Phase
 * 5(a)) together with the already-shipped, self-fallback-guaranteed
 * generateDayStops/generateTransitDayStops (Phase 3/4) plus
 * generateDepartureDayStops (Phase 5(a)) into one from-scratch full
 * itinerary. Not wired into generate-stream/route.ts yet — that's Phase
 * 5(c), which needs a new SSE protocol to actually stream this progressively
 * instead of returning it all at once. Returns null only when planTrip()
 * itself fails (no fallback exists for that specific piece yet — the future
 * route caller decides whether to fall back to the old full-LLM flow); every
 * other generation call here already guarantees a usable result on its own,
 * so there's nothing else this function needs to retry or catch.
 */
export async function assembleItineraryDays(
  flightInfo: FlightInfo,
  prompt: string | undefined,
  preferences: TripPreferences | undefined,
  model: string
): Promise<AssembledItinerary | null> {
  const plan = await planTrip(flightInfo, prompt, preferences, model);
  if (!plan) return null;

  const budget = preferences?.budget as BudgetLevel | undefined;
  const preferenceIntent = NEUTRAL_PREFERENCE_INTENT;

  const arrivalMinute = flightInfo.arrivalTime
    ? parseTimeString(flightInfo.arrivalTime, DEFAULT_ARRIVAL_MINUTE_FALLBACK)
    : undefined;
  const arrivalDayStartMinute = computeArrivalDayStartMinute(arrivalMinute);

  const days: Array<Record<string, unknown>> = [];

  for (let cityIdx = 0; cityIdx < plan.cities.length; cityIdx++) {
    const city = plan.cities[cityIdx];
    const isFirst = cityIdx === 0;
    const isLast = cityIdx === plan.cities.length - 1;

    // Places already used elsewhere in this city's own block this request —
    // without tracking this, the transit-arrival stops, sightseeing days, and
    // (for the last city) departure stops each independently query the same
    // small tourist_attraction candidate pool and can suggest the same
    // top-rated landmark more than once in the same trip (caught in manual
    // verification: Kyoto's transit-arrival stops and its sightseeing day
    // both picked 清水寺/伏見稻荷大社; Osaka's transit-arrival and departure
    // stops were identical).
    const usedPlaceIds = new Set<string>();

    const sightseeingCount = city.days - (isFirst ? 0 : 1);
    const nights = sightseeingCount + (isLast ? 1 : 0);

    // Meals/accommodation don't depend on which attractions get picked, so
    // this can run alongside the transit day's generation below rather than
    // waiting on it.
    const mealsAndAccommodationPromise = generateMealsAndAccommodation(city.name, nights, plan.currency);

    if (!isFirst) {
      const prevCity = plan.cities[cityIdx - 1];
      const [transitStops, mealsAndAccommodation] = await Promise.all([
        generateTransitDayStops(prevCity.name, city.name, plan.currency, budget, preferenceIntent),
        mealsAndAccommodationPromise,
      ]);
      for (const placeId of extractPlaceIds(transitStops)) usedPlaceIds.add(placeId);

      const hasAccommodation = Object.keys(mealsAndAccommodation.accommodation).length > 0;
      days.push({
        id: crypto.randomUUID(),
        day: 0,
        theme: `移動日：前往${city.name}`,
        isTransitDay: true,
        transitTo: city.name,
        waypointCity: prevCity.name,
        stops: transitStops,
        // The transit day's own night is spent in the destination city —
        // same accommodation as the sightseeing days that follow it.
        accommodation: hasAccommodation ? mealsAndAccommodation.accommodation : undefined,
      });
    }

    const sightseeingStops =
      sightseeingCount > 0
        ? await generateDayStops(
            city.name,
            sightseeingCount,
            plan.currency,
            Array.from(usedPlaceIds),
            budget,
            preferenceIntent,
            isFirst ? arrivalDayStartMinute : undefined
          )
        : [];
    for (const dayStops of sightseeingStops) {
      for (const placeId of extractPlaceIds(dayStops)) usedPlaceIds.add(placeId);
    }

    const mealsAndAccommodation = await mealsAndAccommodationPromise;
    const hasAccommodation = Object.keys(mealsAndAccommodation.accommodation).length > 0;
    const accommodation = hasAccommodation ? mealsAndAccommodation.accommodation : undefined;

    for (let i = 0; i < sightseeingStops.length; i++) {
      days.push({
        id: crypto.randomUUID(),
        day: 0,
        theme: `${city.name} 探索`,
        waypointCity: city.name,
        stops: sightseeingStops[i],
        accommodation,
        meals: mealsAndAccommodation.mealsByDay[i] ?? {},
      });
    }

    if (isLast) {
      const departureStops = await generateDepartureDayStops(
        city.name,
        plan.currency,
        flightInfo.returnDepartureTime,
        budget,
        preferenceIntent,
        Array.from(usedPlaceIds)
      );
      days.push({
        id: crypto.randomUUID(),
        day: 0,
        theme: "返程日",
        waypointCity: city.name,
        stops: departureStops,
        // The last day is a departure day — no accommodation, matching the
        // existing big-prompt rule (itineraryGen.ts buildSystemPrompt rule 7).
        accommodation: null,
        meals: mealsAndAccommodation.mealsByDay[sightseeingCount] ?? {},
      });
    }
  }

  return {
    title: plan.title,
    currency: plan.currency,
    days: days.map((d, i) => ({ ...d, day: i + 1 })),
  };
}

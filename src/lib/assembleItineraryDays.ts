import type { FlightInfo, TripPreferences } from "@/lib/schemas";
import type { BudgetLevel } from "@/lib/fetchCityRestaurants";
import { planTrip, type TripPlan } from "@/lib/tripPlan";
import {
  generateTransitDayStops,
  generateDepartureDayStops,
  generateMealsAndAccommodation,
  mealPreferencesOf,
  parseTimeString,
} from "@/lib/itineraryCityGen";
import { parsePreferenceIntent } from "@/lib/preferenceIntent";
import { mergePreferenceIntent } from "@/lib/mergePreferenceIntent";
import { computeArrivalDayStartMinute } from "@/lib/scheduler/arrivalDayStart";
import { planDayEvents, type PlannedDayEvents } from "@/lib/fixedEventVenues";
import { carPickup, carReturnStop, findCarRental } from "@/lib/carRental";
import {
  DOMESTIC_ARRIVAL_BUFFER_MINUTES,
  DOMESTIC_DEPARTURE_BUFFER_MINUTES,
  domesticJourneyEvents,
  isDomestic,
} from "@/lib/domesticTrips";
import { buildStayDays, locationOf, stayContextOf } from "@/lib/cityStayDays";
import { fillMissingCopy } from "@/lib/missingCopy";

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
  const domestic = isDomestic(flightInfo);
  // 國內: the traveler's own car or trains and buses (domesticTrips.ts).
  const preferenceIntent = { ...mergePreferenceIntent(preferences, parsedIntent), ...(domestic ? { domestic: true } : {}) };
  const mealPreferences = mealPreferencesOf(preferenceIntent, preferences?.drinks);

  const arrivalMinute = flightInfo.arrivalTime
    ? parseTimeString(flightInfo.arrivalTime, DEFAULT_ARRIVAL_MINUTE_FALLBACK)
    : undefined;
  const arrivalDayStartMinute = computeArrivalDayStartMinute(
    arrivalMinute,
    domestic ? DOMESTIC_ARRIVAL_BUFFER_MINUTES : undefined
  );
  // 國內: the way there and home, blocked on the first and last day.
  const journeyEvents = domesticJourneyEvents(flightInfo, Boolean(preferenceIntent.selfDrive), Boolean(preferenceIntent.pets));
  // Abroad, a self-driver rents at the airport; at home they drive their own car.
  const rentsCar = Boolean(preferenceIntent.selfDrive) && !domestic;

  const days: Array<Record<string, unknown>> = [];
  let nextDayNumber = 1;
  // Names of the stops already on the trip in a city, for the morning before leaving it.
  const visitedIn = (cityName: string) =>
    days
      .filter((d) => d.waypointCity === cityName || d.transitTo === cityName)
      .flatMap((d) => (Array.isArray(d.stops) ? d.stops : []))
      .map((s) => (s as Record<string, unknown>).name)
      .filter((name): name is string => typeof name === "string");

  function pushDay(day: Record<string, unknown>) {
    const numbered = { ...day, day: nextDayNumber++ };
    days.push(numbered);
    onProgress?.({ type: "day", day: numbered });
  }

  const usedPlaceIdsByCity = new Map<string, Set<string>>();
  // Sightseeing days so far, so the theme rotation runs across the whole trip.
  let themedDaysSoFar = 0;
  // What every city's sightseeing days share (cityStayDays.ts).
  const stay = stayContextOf({
    preferences,
    preferenceIntent,
    mealPreferences,
    budget,
    currency: plan.currency,
    model,
    departureDate: flightInfo.departureDate,
    returnDate: flightInfo.returnDate,
    routeCityNames: plan.cities.map((c) => c.name),
  });
  // 固定行程 (plan/form-preference-wiring.md 1.11) by the trip day they fall on.
  const { eventsOn, eventMealContext } = stay;
  const eventStops = (planned: PlannedDayEvents) => planned.fixed.flatMap((e) => (e.stop ? [e.stop] : []));

  // 自駕: the rental counters at both airports, looked up once (cached).
  const [pickupRental, returnRental] = rentsCar
    ? await Promise.all([
        findCarRental(flightInfo.arrivalCity).catch(() => undefined),
        findCarRental(flightInfo.returnDepartureCity).catch(() => undefined),
      ])
    : [undefined, undefined];

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
      // Planned before the lodging is known (transit stops are generated
      // alongside it), so work with no place given has no lodging to go to.
      const transitEvents = await planDayEvents(eventsOn(nextDayNumber), city.name, undefined, eventMealContext);
      for (const stop of eventStops(transitEvents)) {
        if (typeof stop.placeId === "string") usedPlaceIds.add(stop.placeId);
      }
      const [transitStops, mealsAndAccommodation] = await Promise.all([
        generateTransitDayStops(
          prevCity.name,
          city.name,
          plan.currency,
          budget,
          preferenceIntent,
          Array.from(usedPlaceIds),
          transitEvents.fixed,
          visitedIn(prevCity.name)
        ),
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
        meals: { ...withoutBreakfast(mealsAndAccommodation.mealsByDay[0]), ...transitEvents.meals },
      });
    }

    const mealsAndAccommodation = await mealsAndAccommodationPromise;
    const hasAccommodation = Object.keys(mealsAndAccommodation.accommodation).length > 0;
    const accommodation = hasAccommodation ? mealsAndAccommodation.accommodation : undefined;
    const lodging = locationOf(accommodation);

    const { days: sightseeingDays, themedDays } = await buildStayDays(
      {
        cityName: city.name,
        count: sightseeingCount,
        firstDayNumber: nextDayNumber,
        accommodation,
        mealsByDay: mealsAndAccommodation.mealsByDay.slice(transitMealDays, transitMealDays + sightseeingCount),
        usedPlaceIds,
        firstThemeIndex: themedDaysSoFar,
        firstDayStartMinute: isFirst ? arrivalDayStartMinute : undefined,
        // A self-driver picks up the car first thing on day 1; 國內, the way there opens it.
        firstDayFixed: isFirst
          ? [
              ...(rentsCar
                ? [
                    carPickup(pickupRental, arrivalDayStartMinute, {
                      arrivalIata: flightInfo.arrivalCity,
                      returnIata: flightInfo.returnDepartureCity,
                    }),
                  ]
                : []),
              ...(journeyEvents.outbound ? [journeyEvents.outbound] : []),
            ]
          : undefined,
      },
      stay
    );
    themedDaysSoFar += themedDays;
    for (const day of sightseeingDays) pushDay(day);

    if (isLast) {
      const departureEvents = await planDayEvents(eventsOn(nextDayNumber), city.name, lodging, eventMealContext);
      for (const stop of eventStops(departureEvents)) {
        if (typeof stop.placeId === "string") usedPlaceIds.add(stop.placeId);
      }
      const departureStops = await generateDepartureDayStops(
        city.name,
        plan.currency,
        flightInfo.returnDepartureTime,
        budget,
        preferenceIntent,
        Array.from(usedPlaceIds),
        lodging,
        // 國內: the way home closes the last day.
        journeyEvents.homebound ? [...departureEvents.fixed, journeyEvents.homebound] : departureEvents.fixed,
        rentsCar ? (minute) => carReturnStop(returnRental, minute) : undefined,
        domestic ? DOMESTIC_DEPARTURE_BUFFER_MINUTES : undefined
      );
      pushDay({
        id: crypto.randomUUID(),
        theme: "返程日",
        waypointCity: city.name,
        stops: departureStops,
        // The last day is a departure day — no accommodation, matching the
        // existing big-prompt rule (itineraryGen.ts buildSystemPrompt rule 7).
        accommodation: null,
        meals: {
          ...withoutNightcap(mealsAndAccommodation.mealsByDay[transitMealDays + sightseeingCount]),
          ...departureEvents.meals,
        },
      });
    }
  }

  // Places the program put in itself get their description now, in one call (missingCopy.ts).
  await fillMissingCopy(days, model);

  return {
    title: plan.title,
    currency: plan.currency,
    days,
  };
}

import type { FlightInfo, TripPreferences } from "@/lib/schemas";
import type { BudgetLevel, PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { planTrip, type TripPlan } from "@/lib/tripPlan";
import {
  generateThemedDayStops,
  dayStartFor,
  SIGHTSEEING_DAY_END_MINUTE,
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
import { dateOfTripDay, tripDayOfDate } from "@/lib/fixedEvents";
import { getClimate, isInSeason } from "@/lib/climate";
import { conditionsOf, weatherNote } from "@/lib/dayConditions";
import { planDayEvents, type PlannedDayEvents } from "@/lib/fixedEventVenues";
import { carPickup, carReturnStop, findCarRental } from "@/lib/carRental";
import { getCityCenter } from "@/lib/placesTextSearch";
import {
  findSuburbPlace,
  isInOtherCity,
  MAX_SUBURB_KM,
  suburbDayIndex,
  suburbGroupsFor,
  suburbKindFor,
  suburbTripEvent,
  type SuburbKind,
} from "@/lib/suburbTrips";
import { restaurantNear } from "@/lib/fixedEventVenues";
import { findSeasonalDay, nightHighlightEvent, seasonalDayIndex } from "@/lib/seasonalHighlights";
import { classicTripEvents, findClassicDayTrip } from "@/lib/classicDayTrips";
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
  // 固定行程 (plan/form-preference-wiring.md 1.11) by the trip day they fall on.
  const eventsOn = (dayNumber: number) =>
    (preferences?.fixedEvents ?? []).filter(
      (e) => tripDayOfDate(e.date, flightInfo.departureDate, flightInfo.returnDate) === dayNumber
    );
  const eventStops = (planned: PlannedDayEvents) => planned.fixed.flatMap((e) => (e.stop ? [e.stop] : []));
  const selfDrive = Boolean(preferenceIntent.selfDrive);
  // Which kinds of suburb place, from the traveler's interests and drinks.
  const suburbGroups = suburbGroupsFor(preferenceIntent.interestBoost, preferences?.drinks ?? []);
  const usedSuburbIds = new Set<string>();
  // The route's other cities, which a day trip shouldn't land in.
  const otherCityCenters = async (cityName: string, apiKey: string) => {
    const names = [...new Set(plan.cities.map((c) => c.name))].filter((name) => name !== cityName);
    const centers = await Promise.all(names.map((name) => getCityCenter(name, apiKey).catch(() => null)));
    return centers.filter((c): c is { lat: number; lng: number } => Boolean(c));
  };

  // 自駕: the rental counters at both airports, looked up once (cached).
  const [pickupRental, returnRental] = preferenceIntent.selfDrive
    ? await Promise.all([
        findCarRental(flightInfo.arrivalCity).catch(() => undefined),
        findCarRental(flightInfo.returnDepartureCity).catch(() => undefined),
      ])
    : [undefined, undefined];
  // Dinner near a show's venue follows the same budget and diet as other meals.
  const eventMealContext = {
    budget,
    dietaryRestrictions: mealPreferences.dietaryRestrictions,
    currency: plan.currency,
  };
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

    const sightseeingEvents = await Promise.all(
      Array.from({ length: sightseeingCount }, (_, i) =>
        planDayEvents(eventsOn(nextDayNumber + i), city.name, lodging, eventMealContext)
      )
    );
    // A self-driver picks up the car first thing on day 1.
    if (isFirst && preferenceIntent.selfDrive && sightseeingEvents.length > 0) {
      sightseeingEvents[0].fixed.unshift(
        carPickup(pickupRental, arrivalDayStartMinute, {
          arrivalIata: flightInfo.arrivalCity,
          returnIata: flightInfo.returnDepartureCity,
        })
      );
    }
    // 郊區: a day out of the city when the stay has room (suburbTrips.ts) —
    // on a day without fixed events, never a city's first.
    const planSuburbTrip = async (eventCounts: number[]) => {
      const kind: SuburbKind | undefined = suburbKindFor(sightseeingCount);
      const dayIndex = suburbDayIndex(eventCounts);
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (!kind || dayIndex === undefined || !apiKey) return undefined;
      const center = await getCityCenter(city.name, apiKey).catch(() => null);
      if (!center) return undefined;
      const tripDate = dateOfTripDay(flightInfo.departureDate, nextDayNumber + dayIndex);
      const dayStart = dayStartFor(preferenceIntent);
      // A whole day goes to a classic town first (鎌倉, 箱根, 日光 from 東京,
      // classicDayTrips.ts); the nearby outdoors when none is found.
      if (kind === "day") {
        const classic = await findClassicDayTrip(
          city.name,
          center,
          apiKey,
          preferenceIntent.interestBoost,
          model,
          new Set([...usedPlaceIds, ...usedSuburbIds]),
          async (town) => !isInOtherCity(town, await otherCityCenters(city.name, apiKey)),
          (place) => isInSeason(place, tripDate)
        );
        if (classic) {
          const events = classicTripEvents(classic, city.name, dayStart, SIGHTSEEING_DAY_END_MINUTE, selfDrive);
          for (const stop of events.flatMap((e) => (e.stop ? [e.stop] : []))) {
            usedSuburbIds.add(String(stop.placeId));
            usedPlaceIds.add(String(stop.placeId));
          }
          const first = classic.sights[0];
          const lunch = await restaurantNear(
            { placeId: first.placeId, name: first.name, lat: first.lat, lng: first.lng },
            eventMealContext,
            `在${classic.town}吃午餐`,
            3000
          ).catch(() => undefined);
          return { dayIndex, kind, name: classic.town, events, lunch };
        }
      }
      const found = await findSuburbPlace(
        center,
        apiKey,
        suburbGroups,
        MAX_SUBURB_KM,
        new Set([...usedPlaceIds, ...usedSuburbIds]),
        async (place) => !isInOtherCity(place, await otherCityCenters(city.name, apiKey)) && (await isInSeason(place, tripDate))
      );
      if (!found) return undefined;
      usedSuburbIds.add(found.place.placeId);
      usedPlaceIds.add(found.place.placeId);
      const event = suburbTripEvent(found.place, found.group, kind, dayStart, SIGHTSEEING_DAY_END_MINUTE, selfDrive);
      // A day out eats lunch out there, not back downtown.
      const lunch =
        kind === "day"
          ? await restaurantNear(
              { placeId: found.place.placeId, name: found.place.name, lat: found.place.lat, lng: found.place.lng },
              eventMealContext,
              `在${found.place.name}附近吃午餐`,
              3000
            ).catch(() => undefined)
          : undefined;
      return { dayIndex, kind, name: found.place.name, events: [event], lunch };
    };
    const suburbTrip = await planSuburbTrip(sightseeingEvents.map((e) => e.fixed.length));
    if (suburbTrip) sightseeingEvents[suburbTrip.dayIndex].fixed.push(...suburbTrip.events);

    // 季節限定: a day around what the city is known for this month
    // (seasonalHighlights.ts), unless the traveler turned it off.
    const planSeasonalDay = async (eventCounts: number[]) => {
      if (preferences?.seasonalHighlights === false) return undefined;
      const dayIndex = seasonalDayIndex(eventCounts, suburbTrip?.dayIndex);
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      if (dayIndex === undefined || !apiKey) return undefined;
      const center = await getCityCenter(city.name, apiKey).catch(() => null);
      if (!center) return undefined;
      const tripDate = dateOfTripDay(flightInfo.departureDate, nextDayNumber + dayIndex);
      const day = await findSeasonalDay(city.name, center, apiKey, tripDate, model, usedPlaceIds);
      return day ? { dayIndex, ...day } : undefined;
    };
    const seasonalDay = await planSeasonalDay(sightseeingEvents.map((e) => e.fixed.length));
    // Illuminations get the evening; the rest go to the scheduler for that day only.
    const seasonalByDay = sightseeingEvents.map(() => undefined as PlaceCandidate[] | undefined);
    const seasonalNotes = new Map<string, string>();
    if (seasonalDay) {
      for (const h of seasonalDay.highlights) {
        if (h.night) sightseeingEvents[seasonalDay.dayIndex].fixed.push(nightHighlightEvent(h));
        else seasonalNotes.set(h.place.placeId, h.note);
      }
      seasonalByDay[seasonalDay.dayIndex] = seasonalDay.highlights.filter((h) => !h.night).map((h) => h.place);
    }
    // A concert at 東京巨蛋 shouldn't also turn up as a sightseeing stop there.
    for (const stop of sightseeingEvents.flatMap(eventStops)) {
      if (typeof stop.placeId === "string") usedPlaceIds.add(stop.placeId);
    }

    // 日落和天氣 (dayConditions.ts): each day's sunset, and whether the month
    // is hot or rainy, from last year's weather at the city center (cached per month).
    const conditionsByDay = await (async () => {
      const apiKey = process.env.GOOGLE_PLACES_API_KEY;
      const center = apiKey && sightseeingCount > 0 ? await getCityCenter(city.name, apiKey).catch(() => null) : null;
      return Promise.all(
        Array.from({ length: sightseeingCount }, async (_, i) => {
          if (!center) return undefined;
          const tripDate = dateOfTripDay(flightInfo.departureDate, nextDayNumber + i);
          return conditionsOf(await getClimate(center.lat, center.lng, tripDate), tripDate);
        })
      );
    })();

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
            themedDaysSoFar,
            sightseeingEvents.map((e) => e.fixed),
            seasonalByDay,
            conditionsByDay
          )
        : { stopsByDay: [], themeByDay: [] };
    themedDaysSoFar += sightseeingCount;
    for (const dayStops of sightseeingStops) {
      for (const placeId of extractPlaceIds(dayStops)) usedPlaceIds.add(placeId);
    }

    for (let i = 0; i < sightseeingStops.length; i++) {
      const dayTheme = themeByDay[i];
      const trip = suburbTrip?.dayIndex === i ? suburbTrip : undefined;
      const seasonal = seasonalDay?.dayIndex === i ? seasonalDay : undefined;
      pushDay({
        id: crypto.randomUUID(),
        theme: trip
          ? `${city.name} ${trip.kind === "day" ? "一日遊" : "半日遊"}：${trip.name}`
          : seasonal
            ? `${city.name} 季節限定：${seasonal.label}`
            : `${city.name} ${dayTheme ? THEMES[dayTheme].label : "探索"}`,
        waypointCity: city.name,
        stops: seasonal ? withSeasonalNotes(sightseeingStops[i], seasonalNotes) : sightseeingStops[i],
        accommodation,
        meals: {
          ...(mealsAndAccommodation.mealsByDay[transitMealDays + i] ?? {}),
          ...sightseeingEvents[i].meals,
          ...(trip?.lunch ? { lunch: trip.lunch } : {}),
        },
        // A whole day out stays as planned when the trip is restructured.
        ...(trip?.kind === "day" ? { isLocked: true } : {}),
        ...(weatherNote(conditionsByDay[i]) ? { weatherNote: weatherNote(conditionsByDay[i]) } : {}),
      });
    }

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
        departureEvents.fixed,
        preferenceIntent.selfDrive ? (minute) => carReturnStop(returnRental, minute) : undefined
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

/** A highlight's timing note after the stop's own description: 「通常在 11 月中下旬最美」. */
function withSeasonalNotes(stops: Array<Record<string, unknown>>, notes: Map<string, string>): Array<Record<string, unknown>> {
  return stops.map((stop) => {
    const note = typeof stop.placeId === "string" ? notes.get(stop.placeId) : undefined;
    if (!note) return stop;
    const description = typeof stop.description === "string" && stop.description ? `${stop.description} ${note}` : note;
    return { ...stop, description };
  });
}

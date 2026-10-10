import type { FixedEvent, PreferenceIntent, TripPreferences } from "@/lib/schemas";
import type { BudgetLevel, PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { generateThemedDayStops, dayStartFor, dayEndFor, type MealPreferences } from "@/lib/itineraryCityGen";
import { THEMES } from "@/lib/dayThemes";
import { dateOfTripDay, tripDayOfDate, type DayFixedEvents } from "@/lib/fixedEvents";
import { getClimate, isInSeason } from "@/lib/climate";
import { conditionsOf, weatherNote } from "@/lib/dayConditions";
import { planDayEvents, restaurantNear, type PlannedDayEvents } from "@/lib/fixedEventVenues";
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
import { findSeasonalDay, nightHighlightEvent, seasonalDayIndex } from "@/lib/seasonalHighlights";
import { cleanTitles, findFilmDay } from "@/lib/filmLocations";
import { classicTripEvents, findClassicDayTrip } from "@/lib/classicDayTrips";
import {
  campsiteStay,
  findCampsite,
  findHotSpringSoak,
  findNightMarkets,
  hotSpringSoakEvent,
  isHotSpringStay,
  nightMarketDays,
  nightMarketDinner,
} from "@/lib/domesticInterests";

// A city's sightseeing days, with everything the form's preferences add to
// them: the day's theme, a day trip, the seasonal and film days, booked
// events, the weather, night markets, hot springs and camping. Shared by
// generation (assembleItineraryDays.ts) and 重新規劃 (restructure/route.ts),
// so a new preference only has to be added here (plan/restructure-wizard-ux.md).

/** What a trip's cities share. Built once per trip with stayContextOf. */
export type StayContext = {
  preferences: TripPreferences | undefined;
  preferenceIntent: PreferenceIntent;
  budget: BudgetLevel | undefined;
  currency: string;
  model: string;
  /** Day 1's date: each day's date comes from it (seasons, weather, booked events). */
  departureDate: string;
  /** Booked events (固定行程) still to place, by the trip day they fall on. */
  eventsOn: (dayNumber: number) => FixedEvent[];
  /** Dinner near a show's venue follows the same budget and diet as other meals. */
  eventMealContext: { budget: BudgetLevel | undefined; dietaryRestrictions: string[] | undefined; currency: string };
  suburbGroups: ReturnType<typeof suburbGroupsFor>;
  selfDrive: boolean;
  /** The route's other cities, which a day trip shouldn't land in. */
  otherCityCenters: (cityName: string, apiKey: string) => Promise<{ lat: number; lng: number }[]>;
  /** Day-trip places used anywhere on the trip. */
  usedSuburbIds: Set<string>;
  /** One night camping per trip. */
  campNightPlanned: boolean;
};

export function stayContextOf(input: {
  preferences: TripPreferences | undefined;
  preferenceIntent: PreferenceIntent;
  mealPreferences: MealPreferences;
  budget: BudgetLevel | undefined;
  currency: string;
  model: string;
  departureDate: string;
  returnDate: string;
  /** Every city on the route. */
  routeCityNames: string[];
  /** Booked events to place; 重新規劃 leaves out those already on a kept day. */
  fixedEvents?: FixedEvent[];
  /** A camping night already on the trip (a kept day). */
  campNightPlanned?: boolean;
}): StayContext {
  const { preferences, preferenceIntent, departureDate, returnDate } = input;
  const fixedEvents = input.fixedEvents ?? preferences?.fixedEvents ?? [];
  const routeCityNames = [...new Set(input.routeCityNames)];
  return {
    preferences,
    preferenceIntent,
    budget: input.budget,
    currency: input.currency,
    model: input.model,
    departureDate,
    eventsOn: (dayNumber) => fixedEvents.filter((e) => tripDayOfDate(e.date, departureDate, returnDate) === dayNumber),
    eventMealContext: {
      budget: input.budget,
      dietaryRestrictions: input.mealPreferences.dietaryRestrictions,
      currency: input.currency,
    },
    // Which kinds of suburb place, from the traveler's interests and drinks.
    suburbGroups: suburbGroupsFor(
      preferenceIntent.interestBoost,
      preferences?.drinks ?? [],
      Boolean(preferenceIntent.kids),
      Boolean(preferenceIntent.seniors)
    ),
    selfDrive: Boolean(preferenceIntent.selfDrive),
    otherCityCenters: async (cityName, apiKey) => {
      const names = routeCityNames.filter((name) => name !== cityName);
      const centers = await Promise.all(names.map((name) => getCityCenter(name, apiKey).catch(() => null)));
      return centers.filter((c): c is { lat: number; lng: number } => Boolean(c));
    },
    usedSuburbIds: new Set(),
    campNightPlanned: input.campNightPlanned ?? false,
  };
}

export type StayDaysInput = {
  cityName: string;
  /** How many sightseeing days to build. */
  count: number;
  /** The trip day number of the first of them (day 1 is the departure date). */
  firstDayNumber: number;
  /** Where the traveler sleeps; stops are planned around it. */
  accommodation: Record<string, unknown> | undefined;
  /** Each day's meals, already picked (generateMealsAndAccommodation). */
  mealsByDay: Array<Record<string, unknown> | undefined>;
  /** Places already on the trip in this city — added to as days are planned. */
  usedPlaceIds: Set<string>;
  /** Where the theme rotation continues from: the trip's sightseeing days before these. */
  firstThemeIndex: number;
  /** The trip's first day starts when the traveler arrives. */
  firstDayStartMinute?: number;
  /** Blocks opening the first day: picking up the rental car, the 國內 way there. */
  firstDayFixed?: DayFixedEvents;
};

/**
 * The days, in order, without day numbers, and how many of them took a theme
 * (for the next city's rotation). Never throws for a missing or failed
 * lookup: each extra (day trip, seasonal day, night market…) is just left out.
 */
export async function buildStayDays(
  input: StayDaysInput,
  ctx: StayContext
): Promise<{ days: Array<Record<string, unknown>>; themedDays: number }> {
  const { cityName, count, firstDayNumber, accommodation, mealsByDay, usedPlaceIds } = input;
  const { preferences, preferenceIntent, model, eventMealContext } = ctx;
  if (count <= 0) return { days: [], themedDays: 0 };
  const lodging = locationOf(accommodation);
  const wants = (tag: string) => Boolean(preferences?.interests?.includes(tag as never));
  const eventStops = (planned: PlannedDayEvents) => planned.fixed.flatMap((e) => (e.stop ? [e.stop] : []));

  const sightseeingEvents = await Promise.all(
    Array.from({ length: count }, (_, i) => planDayEvents(ctx.eventsOn(firstDayNumber + i), cityName, lodging, eventMealContext))
  );
  if (input.firstDayFixed?.length) sightseeingEvents[0].fixed.unshift(...input.firstDayFixed);

  // 郊區: a day out of the city when the stay has room (suburbTrips.ts) —
  // on a day without fixed events, never a city's first.
  const planSuburbTrip = async (eventCounts: number[]) => {
    const kind: SuburbKind | undefined = suburbKindFor(count);
    const dayIndex = suburbDayIndex(eventCounts);
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!kind || dayIndex === undefined || !apiKey) return undefined;
    const center = await getCityCenter(cityName, apiKey).catch(() => null);
    if (!center) return undefined;
    const tripDate = dateOfTripDay(ctx.departureDate, firstDayNumber + dayIndex);
    const dayStart = dayStartFor(preferenceIntent);
    // A whole day goes to a classic town first (鎌倉, 箱根, 日光 from 東京,
    // classicDayTrips.ts); the nearby outdoors when none is found.
    if (kind === "day") {
      const classic = await findClassicDayTrip(
        cityName,
        center,
        apiKey,
        preferenceIntent.interestBoost,
        model,
        new Set([...usedPlaceIds, ...ctx.usedSuburbIds]),
        async (town) => !isInOtherCity(town, await ctx.otherCityCenters(cityName, apiKey)),
        (place) => isInSeason(place, tripDate)
      );
      if (classic) {
        const events = classicTripEvents(classic, cityName, dayStart, dayEndFor(preferenceIntent), ctx.selfDrive);
        for (const stop of events.flatMap((e) => (e.stop ? [e.stop] : []))) {
          ctx.usedSuburbIds.add(String(stop.placeId));
          usedPlaceIds.add(String(stop.placeId));
        }
        const first = classic.sights[0];
        const lunch = await dayTripLunch(
          { placeId: first.placeId, name: first.name, lat: first.lat, lng: first.lng },
          eventMealContext,
          classic.town,
          `在${classic.town}吃午餐`
        );
        return { dayIndex, kind, name: classic.town, events, lunch };
      }
    }
    const found = await findSuburbPlace(
      center,
      apiKey,
      ctx.suburbGroups,
      MAX_SUBURB_KM,
      new Set([...usedPlaceIds, ...ctx.usedSuburbIds]),
      async (place) => !isInOtherCity(place, await ctx.otherCityCenters(cityName, apiKey)) && (await isInSeason(place, tripDate))
    );
    if (!found) return undefined;
    ctx.usedSuburbIds.add(found.place.placeId);
    usedPlaceIds.add(found.place.placeId);
    const event = suburbTripEvent(found.place, found.group, kind, dayStart, dayEndFor(preferenceIntent), ctx.selfDrive);
    // A day out eats lunch out there, not back downtown.
    const lunch =
      kind === "day"
        ? await dayTripLunch(
            { placeId: found.place.placeId, name: found.place.name, lat: found.place.lat, lng: found.place.lng },
            eventMealContext,
            found.place.name,
            `在${found.place.name}附近吃午餐`
          )
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
    const center = await getCityCenter(cityName, apiKey).catch(() => null);
    if (!center) return undefined;
    const tripDate = dateOfTripDay(ctx.departureDate, firstDayNumber + dayIndex);
    const day = await findSeasonalDay(cityName, center, apiKey, tripDate, model, usedPlaceIds);
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

  // 影劇追星: a day at filming locations (filmLocations.ts), kept for that
  // day like the seasonal highlights, each with a cautious 「據說」 note.
  const planFilmDay = async (eventCounts: number[]) => {
    if (!preferences?.interests?.includes("film")) return undefined;
    const dayIndex = seasonalDayIndex(eventCounts, [suburbTrip?.dayIndex, seasonalDay?.dayIndex]);
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (dayIndex === undefined || !apiKey) return undefined;
    const center = await getCityCenter(cityName, apiKey).catch(() => null);
    if (!center) return undefined;
    // Not a place the seasonal day already keeps (新宿御苑 was both).
    const seasonalIds = (seasonalDay?.highlights ?? []).map((h) => h.place.placeId);
    const day = await findFilmDay(
      cityName,
      center,
      apiKey,
      cleanTitles(preferences.filmTitles),
      model,
      new Set([...usedPlaceIds, ...seasonalIds])
    );
    return day ? { dayIndex, ...day } : undefined;
  };
  const filmDay = await planFilmDay(sightseeingEvents.map((e) => e.fixed.length));
  if (filmDay) {
    for (const l of filmDay.locations) seasonalNotes.set(l.place.placeId, l.note);
    seasonalByDay[filmDay.dayIndex] = filmDay.locations.map((l) => l.place);
  }

  // 夜市: dinner at a night market on one evening (two from three nights).
  const nightMarketByDay = new Map<number, Record<string, unknown>>();
  // 溫泉 without a hot-spring stay: an early-evening soak, on an evening without a night market.
  // 露營: one night at a campsite instead of the city's lodging.
  let campNight: { dayIndex: number; stay: Record<string, unknown> } | undefined;
  const apiKeyForInterests = process.env.GOOGLE_PLACES_API_KEY;
  const interestCenter =
    apiKeyForInterests && (wants("night_market") || wants("hot_spring") || wants("camping"))
      ? await getCityCenter(cityName, apiKeyForInterests).catch(() => null)
      : null;
  if (interestCenter && apiKeyForInterests) {
    if (wants("night_market")) {
      const days = nightMarketDays(count);
      const markets = await findNightMarkets(interestCenter, apiKeyForInterests, days.length, usedPlaceIds);
      markets.forEach((market, k) => {
        nightMarketByDay.set(days[k], nightMarketDinner(market));
        usedPlaceIds.add(market.placeId);
      });
    }
    if (wants("hot_spring") && !isHotSpringStay(accommodation?.name)) {
      const soak = await findHotSpringSoak(interestCenter, apiKeyForInterests, usedPlaceIds);
      const free = Array.from({ length: count }, (_, i) => count - 1 - i).find(
        (i) => !nightMarketByDay.has(i) && suburbTrip?.dayIndex !== i
      );
      if (soak && free !== undefined) {
        sightseeingEvents[free].fixed.push(hotSpringSoakEvent(soak));
        usedPlaceIds.add(soak.placeId);
      }
    }
    // Only by car: campsites are up in the hills. Claimed before the search,
    // as 重新規劃 builds its cities at the same time.
    if (wants("camping") && preferenceIntent.selfDrive && !ctx.campNightPlanned && count >= 2) {
      ctx.campNightPlanned = true;
      const site = await findCampsite(interestCenter, apiKeyForInterests, cityName);
      if (site) campNight = { dayIndex: count - 2, stay: campsiteStay(site, cityName) };
      else ctx.campNightPlanned = false;
    }
  }
  // A concert at 東京巨蛋 shouldn't also turn up as a sightseeing stop there.
  for (const stop of sightseeingEvents.flatMap(eventStops)) {
    if (typeof stop.placeId === "string") usedPlaceIds.add(stop.placeId);
  }

  // 日落和天氣 (dayConditions.ts): each day's sunset, and whether the month
  // is hot or rainy, from last year's weather at the city center (cached per month).
  const conditionsByDay = await (async () => {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const center = apiKey ? await getCityCenter(cityName, apiKey).catch(() => null) : null;
    return Promise.all(
      Array.from({ length: count }, async (_, i) => {
        if (!center) return undefined;
        const tripDate = dateOfTripDay(ctx.departureDate, firstDayNumber + i);
        return conditionsOf(await getClimate(center.lat, center.lng, tripDate), tripDate);
      })
    );
  })();

  // A day trip, seasonal or film day is titled by it, so the theme rotation skips it.
  const ownTitleDays = new Set(
    [suburbTrip?.dayIndex, seasonalDay?.dayIndex, filmDay?.dayIndex].filter((i): i is number => i !== undefined)
  );
  const { stopsByDay, themeByDay } = await generateThemedDayStops(
    cityName,
    count,
    ctx.currency,
    Array.from(usedPlaceIds),
    ctx.budget,
    preferenceIntent,
    input.firstDayStartMinute,
    lodging,
    input.firstThemeIndex,
    sightseeingEvents.map((e) => e.fixed),
    seasonalByDay,
    conditionsByDay,
    ownTitleDays
  );
  for (const dayStops of stopsByDay) {
    for (const stop of dayStops) {
      if (typeof stop.placeId === "string") usedPlaceIds.add(stop.placeId);
    }
  }

  const days = stopsByDay.map((stops, i) => {
    const dayTheme = themeByDay[i];
    const trip = suburbTrip?.dayIndex === i ? suburbTrip : undefined;
    const seasonal = seasonalDay?.dayIndex === i ? seasonalDay : undefined;
    const film = filmDay?.dayIndex === i ? filmDay : undefined;
    const note = weatherNote(conditionsByDay[i]);
    return {
      id: crypto.randomUUID(),
      theme: trip
        ? `${cityName} ${trip.kind === "day" ? "一日遊" : "半日遊"}：${trip.name}`
        : seasonal
          ? `${cityName} 季節限定：${seasonal.label}`
          : film
            ? `${cityName} 影劇朝聖：${film.label}`
            : `${cityName} ${dayTheme ? THEMES[dayTheme].label : "探索"}`,
      waypointCity: cityName,
      stops: seasonal || film ? withSeasonalNotes(stops, seasonalNotes) : stops,
      accommodation: campNight?.dayIndex === i ? campNight.stay : accommodation,
      meals: {
        ...(mealsByDay[i] ?? {}),
        ...sightseeingEvents[i].meals,
        ...(trip?.lunch ? { lunch: trip.lunch } : {}),
        ...(nightMarketByDay.has(i) ? { dinner: nightMarketByDay.get(i) } : {}),
      },
      // A whole day out stays as planned when the trip is restructured.
      ...(trip?.kind === "day" ? { isLocked: true } : {}),
      ...(note ? { weatherNote: note } : {}),
      // Places people often visit on a tour (tourLinks.ts): the day trip's town, the seasonal theme.
      ...(trip ? { tourKeyword: trip.name } : seasonal ? { tourKeyword: `${cityName} ${seasonal.label}` } : {}),
    };
  });
  return { days, themedDays: count - ownTitleDays.size };
}

// A lodging picked from real candidates carries coordinates; one the LLM
// invented (no candidates) doesn't, and the generators then fall back to the
// city center.
export function locationOf(accommodation: Record<string, unknown> | undefined): { lat: number; lng: number } | undefined {
  const lat = accommodation?.lat;
  const lng = accommodation?.lng;
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : undefined;
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

/**
 * Lunch on a day out, near where the day is spent: within 3km, then 10km —
 * a national park's coordinate is the middle of the park, and 支笏洞爺國立公園
 * had nothing within 3km, so lunch fell back to a sushi place in 札幌. With
 * nothing either way, the day says to eat out there, not back in town.
 */
async function dayTripLunch(
  venue: { placeId: string; name: string; lat: number; lng: number },
  context: Parameters<typeof restaurantNear>[1],
  area: string,
  description: string
): Promise<Record<string, unknown>> {
  for (const radius of [3000, 10000]) {
    const meal = await restaurantNear(venue, context, description, radius).catch(() => undefined);
    if (meal) return meal;
  }
  return { name: `${area}附近用餐`, description: "附近餐廳不多，可以在園區或沿途找地方吃，或自備便當" };
}

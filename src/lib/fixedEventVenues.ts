import { COPY_PENDING } from "@/lib/copyPending";
import {
  fetchNearbyPlaceCandidates,
  getMealPlaceTypes,
  searchTextCandidates,
  type BudgetLevel,
} from "@/lib/fetchCityRestaurants";
import { getCityCenter } from "@/lib/placesTextSearch";
import {
  blockOf,
  eventMeal,
  eventNotes,
  eventStop,
  hasDinnerBefore,
  isMealEvent,
  mealSlotOf,
  type DayFixedEvents,
  type Venue,
} from "@/lib/fixedEvents";
import type { FixedEvent } from "@/lib/schemas";
import { haversineKm } from "@/lib/geo";
import { isFoodPlace } from "@/lib/foodPlace";
import { fitsMainMeal } from "@/lib/cafeMealSlots";
import { excludeByDiet } from "@/lib/dietaryFilter";
import { estimateSlotCost } from "@/lib/priceLevelCost";
import { isGlobalChain } from "@/lib/drinkPlaces";

// A venue the traveler typed can be anywhere in or around the city (a
// stadium in the suburbs), so the bias circle is wide.
const VENUE_SEARCH_RADIUS_M = 50000;

/**
 * The place a traveler typed as a fixed event's venue, by Text Search near
 * the city (Pro fields; cached 30 days, misses included — see
 * searchTextCandidates). Undefined when it can't be found: the event keeps
 * the typed name and generation goes on.
 */
export async function resolveVenue(name: string, cityName: string): Promise<Venue | undefined> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return undefined;
  const center = await getCityCenter(cityName, apiKey);
  if (!center) return undefined;
  const [place] = await searchTextCandidates(name, center, apiKey, VENUE_SEARCH_RADIUS_M);
  return place ? { placeId: place.placeId, name: place.name, lat: place.lat, lng: place.lng, address: place.address } : undefined;
}

// Dinner before a show: somewhere a short walk from the venue.
const DINNER_NEAR_VENUE_RADIUS_M = 800;
const LODGING_TYPES = new Set(["hotel", "lodging", "resort_hotel", "inn", "ryokan", "japanese_inn", "motel", "hostel"]);

/** What a dinner near the venue has to respect — the same as the trip's other meals. */
export type MealContext = { budget?: BudgetLevel; dietaryRestrictions?: string[]; currency?: string };

/**
 * A restaurant near a place for a meal there (dinner before a show, lunch on
 * a day trip), or undefined when nothing's nearby. One Nearby Search per
 * place, Pro fields, cached like any meal pool.
 */
export async function restaurantNear(
  venue: Venue,
  context: MealContext,
  description: string,
  radiusM = DINNER_NEAR_VENUE_RADIUS_M
): Promise<Record<string, unknown> | undefined> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return undefined;
  const places = await fetchNearbyPlaceCandidates(
    { lat: venue.lat, lng: venue.lng },
    apiKey,
    getMealPlaceTypes("dinner", context.budget),
    radiusM,
    20,
    "pro"
  );
  // The search takes a place with a restaurant type anywhere in its list, so
  // near 東京巨蛋 the most popular "restaurants" were hotels with a dining
  // room (Hotel Kizankan was picked) and a McDonald's.
  const [place] = excludeByDiet(places, context.dietaryRestrictions ?? [])
    .filter(isFoodPlace)
    .filter(fitsMainMeal)
    .filter((p) => !p.types?.some((t) => LODGING_TYPES.has(t)) && !isGlobalChain(p.name));
  if (!place) return undefined;
  const cost = estimateSlotCost(context.currency, "dinner", place.priceLevel);
  return {
    name: place.name,
    description,
    // 「在鎌倉吃午餐」 says why it's here, not what it is (missingCopy.ts).
    [COPY_PENDING]: true,
    placeId: place.placeId,
    lat: place.lat,
    lng: place.lng,
    address: place.address,
    rating: place.rating ?? null,
    photoName: place.photoName ?? null,
    ...(cost !== undefined ? { estimated_cost: cost } : {}),
  };
}

export type PlannedDayEvents = {
  /** Events that become stops, plus every event's blocked time. */
  fixed: DayFixedEvents;
  /** Meals the events set, by slot: reservations, and dinner near an evening show's venue. */
  meals: Record<string, Record<string, unknown>>;
};

/**
 * One day's fixed events, ready for the scheduler and the meal list. Work
 * with no place given happens at the lodging. A show in the evening brings
 * dinner near the venue before it (unless a reservation already covers
 * dinner), plus reminders for a late finish or a long way back.
 */
export async function planDayEvents(
  events: FixedEvent[],
  cityName: string,
  lodging: { lat: number; lng: number; name?: string } | undefined,
  mealContext: MealContext = {}
): Promise<PlannedDayEvents> {
  const fixed: DayFixedEvents = [];
  const meals: Record<string, Record<string, unknown>> = {};
  let dinnerBefore: Record<string, unknown> | undefined;
  for (const event of events) {
    const typed = event.venueName?.trim();
    const venue: Venue | undefined = typed
      ? await resolveVenue(typed, cityName).catch(() => undefined)
      : event.type === "work" && lodging
        ? { name: "在住宿工作", lat: lodging.lat, lng: lodging.lng }
        : undefined;
    if (isMealEvent(event)) {
      fixed.push({ block: blockOf(event) });
      meals[mealSlotOf(event)] = eventMeal(event, venue);
      continue;
    }
    const km = venue && lodging ? haversineKm(lodging.lat, lodging.lng, venue.lat, venue.lng) : undefined;
    fixed.push({ block: blockOf(event), stop: eventStop(event, venue, eventNotes(event, km)) });
    if (venue && !dinnerBefore && hasDinnerBefore(event)) {
      dinnerBefore = await restaurantNear(venue, mealContext, `開場前在${venue.name}附近用餐`).catch(() => undefined);
    }
  }
  // A dinner reservation the traveler made wins over a suggestion.
  if (dinnerBefore && !meals.dinner) meals.dinner = dinnerBefore;
  return { fixed, meals };
}

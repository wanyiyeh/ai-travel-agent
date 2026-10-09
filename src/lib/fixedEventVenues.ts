import { searchTextCandidates } from "@/lib/fetchCityRestaurants";
import { getCityCenter } from "@/lib/placesTextSearch";
import {
  blockOf,
  eventMeal,
  eventStop,
  isMealEvent,
  mealSlotOf,
  type DayFixedEvents,
  type Venue,
} from "@/lib/fixedEvents";
import type { FixedEvent } from "@/lib/schemas";

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

export type PlannedDayEvents = {
  /** Events that become stops, plus every event's blocked time. */
  fixed: DayFixedEvents;
  /** Reservations, by the meal they replace. */
  meals: Record<string, Record<string, unknown>>;
};

/**
 * One day's fixed events, ready for the scheduler and the meal list. Work
 * with no place given happens at the lodging.
 */
export async function planDayEvents(
  events: FixedEvent[],
  cityName: string,
  lodging: { lat: number; lng: number; name?: string } | undefined
): Promise<PlannedDayEvents> {
  const fixed: DayFixedEvents = [];
  const meals: Record<string, Record<string, unknown>> = {};
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
    } else {
      fixed.push({ block: blockOf(event), stop: eventStop(event, venue) });
    }
  }
  return { fixed, meals };
}

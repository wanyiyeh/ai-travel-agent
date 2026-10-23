import { googleFetch } from "@/lib/googleFetch";
import { runMetered } from "@/lib/usageMeter";

/**
 * Fetches back what may not be stored (ADR-0004): a place's name and
 * address, by its place ID, at the moment it's needed. Nothing here is kept
 * past the request — no cache table, no module-level memo — only repeats
 * within one call are merged.
 *
 * Name + address is the Place Details Pro tier (displayName is a Pro field).
 * The request also asks for the location: an Essentials field, so it costs
 * nothing extra, and it brings back coordinates the 30-day purge removed
 * (ADR-0006).
 * Ratings, photos and opening hours are not fetched here: the place details
 * view shows them through Places UI Kit (ADR-0005).
 */

export type PlaceDisplay = { name: string; address: string | null; lat?: number; lng?: number };

// Shown in place of a name Google couldn't give us (quota used up, a
// retired place ID); never stored, since the place keeps its ID.
export const PLACE_UNAVAILABLE_NAME = "（地點資訊暫時無法載入）";

const FIELD_MASK = "displayName,formattedAddress,location";
const CONCURRENCY = 5;

async function fetchOne(placeId: string, apiKey: string): Promise<PlaceDisplay | null> {
  try {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=zh-TW`;
    const res = await googleFetch(url, { headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK } });
    if (!res.ok) {
      console.warn(`[placeDisplay] ${placeId}: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    };
    const name = data.displayName?.text?.trim();
    if (!name) return null;
    const { latitude: lat, longitude: lng } = data.location ?? {};
    return {
      name,
      address: data.formattedAddress ?? null,
      ...(typeof lat === "number" && typeof lng === "number" ? { lat, lng } : {}),
    };
  } catch (err) {
    console.warn(`[placeDisplay] ${placeId}: failed`, err);
    return null;
  }
}

/**
 * Name and address for each place ID, fetched a few at a time. A place that
 * couldn't be looked up maps to null; this never throws. With no API key
 * (unit tests) nothing is fetched.
 */
export async function fetchPlaceDisplays(placeIds: Iterable<string>): Promise<Map<string, PlaceDisplay | null>> {
  const unique = [...new Set(placeIds)];
  const result = new Map<string, PlaceDisplay | null>();
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    for (const id of unique) result.set(id, null);
    return result;
  }
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const id = unique[next++];
      result.set(id, await fetchOne(id, apiKey));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  return result;
}

type Rec = Record<string, unknown>;

// Every place item of a day: its stops, its meals and its lodging.
function itemsOf(day: Rec): Rec[] {
  const items: Rec[] = [];
  if (Array.isArray(day.stops)) items.push(...(day.stops as Rec[]));
  if (day.meals && typeof day.meals === "object") {
    for (const meal of Object.values(day.meals as Rec)) if (meal && typeof meal === "object") items.push(meal as Rec);
  }
  if (day.accommodation && typeof day.accommodation === "object") items.push(day.accommodation as Rec);
  return items;
}

// Only items that came back from storage without their name need a lookup.
function needsDisplay(item: Rec): item is Rec & { placeId: string } {
  return typeof item.placeId === "string" && typeof item.name !== "string";
}

/**
 * Fills in the name, address and fresh coordinates of every place on the
 * chosen days that came back from storage with only its place ID. `days` is changed in place and
 * also returned. A place Google couldn't give a name for gets
 * PLACE_UNAVAILABLE_NAME and `displayUnavailable: true`, so the page still
 * opens; the next write strips both again (placeStorage.ts).
 *
 * `which`: day numbers (`day.day`), "all", or { dayIds } for the routes
 * that address a day by its id.
 */
export type DaysToHydrate = number[] | "all" | { dayIds: string[] };

function isChosen(day: Rec, which: DaysToHydrate): boolean {
  if (which === "all") return true;
  if (Array.isArray(which)) return which.includes(day.day as number);
  return which.dayIds.includes(day.id as string);
}

export async function hydrateDays<T>(days: T[], which: DaysToHydrate): Promise<T[]> {
  const chosen = (days as unknown as Rec[]).filter((d) => d && typeof d === "object" && isChosen(d, which));
  await hydratePlaces(chosen.flatMap(itemsOf));
  return days;
}

/**
 * Same as hydrateDays, for loose place items: a trashed stop, a page of
 * candidate history. Changed in place and returned.
 */
export async function hydratePlaces<T>(places: T[]): Promise<T[]> {
  const items = (places as unknown as Rec[]).filter((p) => p && typeof p === "object" && needsDisplay(p)) as (Rec & {
    placeId: string;
  })[];
  if (items.length === 0) return places;

  const displays = await fetchPlaceDisplays(items.map((i) => i.placeId));
  for (const item of items) {
    const display = displays.get(item.placeId);
    if (display) {
      item.name = display.name;
      if (display.address) item.address = display.address;
      // Fresh coordinates, stamped now so a write keeps them another 30 days.
      if (display.lat !== undefined && display.lng !== undefined) {
        item.lat = display.lat;
        item.lng = display.lng;
        item.coordsFetchedAt = new Date().toISOString();
      }
    } else {
      item.name = PLACE_UNAVAILABLE_NAME;
      item.displayUnavailable = true;
    }
  }
  return places;
}

/** hydratePlaces inside its own metered run, for routes outside authorizeItinerary's. */
export function hydratePlacesMetered<T>(places: T[]): Promise<T[]> {
  return runMetered("hydrate", () => hydratePlaces(places));
}

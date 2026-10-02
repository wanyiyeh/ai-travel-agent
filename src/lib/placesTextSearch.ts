import { lookupByQuery, upsertPlace } from "@/lib/placeCache";
import { prisma } from "@/lib/db";
import { haversineKm } from "@/lib/distanceMatrix";
import { googleFetch } from "@/lib/googleFetch";

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

// Thrown when the Places API request itself fails (quota exhausted, 5xx,
// auth issues) — distinct from a legitimate "no such place" result, so
// callers that show the user a message can tell "try a different name"
// apart from "the search service is down right now".
export class PlacesApiError extends Error {
  constructor(public readonly status: number) {
    super(`Places API request failed with status ${status}`);
    this.name = "PlacesApiError";
  }
}

export interface TextSearchPlace {
  id: string;
  displayName: { text: string };
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  rating?: number;
  priceLevel?: string;
  photos?: { name: string; widthPx?: number; heightPx?: number }[];
}

// Kept to Pro-tier fields on purpose. A request bills at the highest tier of
// any field in its mask, and `rating`/`priceLevel` are Enterprise-tier: with
// them here, every Text Search billed as Enterprise (1,000 free/month), which
// was ~98% of the 2026-09 Google bill. Pro gets 5,000 free/month. Callers
// already handle both as optional (a cache hit never carried priceLevel),
// and Nearby Search still supplies ratings for meal/lodging candidates.
// `photos` only returns photo *metadata* (a resource name); the actual image
// bytes are a separate billable call via the Photo Media endpoint.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.photos",
].join(",");

// Appending a city name to the query text only nudges Google's text ranking —
// it isn't a hard geo filter. Vague, non-unique activity names (e.g. "咖啡文化
// 體驗", "健行路徑") can still out-rank on keyword match alone and resolve to
// a same-named/keyword place on the other side of the world. locationBias
// breaks that tie in favor of results near the day's actual city.
const CITY_BIAS_RADIUS_METERS = 50000;

// locationBias only re-ranks candidates near the circle — it doesn't exclude
// results outside it. For a query with no real match near the city (e.g. a
// vague activity description), Google can still return its single global
// best text match a continent away. Past that distance the bias has clearly
// lost to a same-keyword homonym, so reject rather than save a wrong-place
// match (mirrors the threshold in scripts/enrich-all-itineraries.ts).
const REJECT_KM_THRESHOLD = 1500;

// Single source of truth for how a stop's Text Search query (and therefore
// its PlaceQuery cache key) is built. Every caller — the single-stop enrich
// route, the bulk enrich-all-stops route, the enrich-all-itineraries script,
// and the cache-only backfill script — must build this string identically,
// or the same real-world place ends up under different cache keys and silently
// re-bills Google on every "backfill" that doesn't actually hit the same key.
export function buildStopQuery(name: string, district: string | null | undefined, cityHint: string): string {
  const namePart = district ? `${name} ${district}` : name;
  return cityHint ? `${namePart} ${cityHint}` : namePart;
}

// Same idea for meals — kept separate from buildStopQuery since meals have
// no district field.
export function buildMealQuery(name: string, cityHint: string): string {
  return cityHint ? `${name} ${cityHint}` : name;
}

// Identical Text Search requests that are in flight at the same time share one
// Google call. Opening an itinerary fires several auto-enrich effects at once
// (EditableItineraryCard's enrich-all-stops + accommodation/enrich, and
// ItineraryMap's per-stop + accommodation/enrich), and dev-mode StrictMode
// runs each effect twice — all of them miss the cache together and used to
// bill the same query up to 4x. Only concurrent calls are merged; sequential
// repeats are the caches' job. Stored on globalThis (like the Prisma client in
// db.ts) so it survives dev HMR module reloads.
const globalForTextSearch = globalThis as unknown as {
  textSearchInFlight?: Map<string, Promise<TextSearchPlace | null>>;
};
const inFlight = (globalForTextSearch.textSearchInFlight ??= new Map());

export function searchPlaceText(
  query: string,
  apiKey: string,
  locationBias?: { lat: number; lng: number } | null,
  includedType?: string,
): Promise<TextSearchPlace | null> {
  const key = JSON.stringify([query, locationBias?.lat ?? null, locationBias?.lng ?? null, includedType ?? null]);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = searchPlaceTextUncached(query, apiKey, locationBias, includedType).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

async function searchPlaceTextUncached(
  query: string,
  apiKey: string,
  locationBias?: { lat: number; lng: number } | null,
  includedType?: string,
): Promise<TextSearchPlace | null> {
  const res = await googleFetch(PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 1,
      languageCode: "zh-TW",
      ...(locationBias
        ? {
            locationBias: {
              circle: {
                center: { latitude: locationBias.lat, longitude: locationBias.lng },
                radius: CITY_BIAS_RADIUS_METERS,
              },
            },
          }
        : {}),
      // includedType alone is just a ranking preference — Google can still
      // return other types. strictTypeFiltering makes it a hard filter, which
      // is what a city-only search actually needs (see route.ts's city-add path).
      ...(includedType ? { includedType, strictTypeFiltering: true } : {}),
    }),
  });

  if (!res.ok) throw new PlacesApiError(res.status);
  const data = await res.json();
  const place: TextSearchPlace | null = data.places?.[0] ?? null;
  if (!place) return null;

  if (locationBias) {
    const km = haversineKm(
      place.location.latitude,
      place.location.longitude,
      locationBias.lat,
      locationBias.lng,
    );
    if (km > REJECT_KM_THRESHOLD) return null;
  }

  return place;
}

// Cache key prefix keeps city-center lookups in their own namespace within
// the shared PlaceQuery cache so they can't collide with stop/meal queries.
const CITY_CACHE_PREFIX = "city-center:";

// Same 30-day TTL as the other Places caches — a city Google adds or starts
// matching later eventually gets picked up.
const CITY_MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Resolve a city name to a coordinate usable as a locationBias center,
 * cached through the existing place-query cache so repeated enrich calls
 * for the same city don't re-hit the API.
 */
export async function getCityCenter(
  cityName: string,
  apiKey: string,
): Promise<{ lat: number; lng: number } | null> {
  if (!cityName) return null;
  const cacheKey = `${CITY_CACHE_PREFIX}${cityName}`;

  const cached = await lookupByQuery(cacheKey);
  if (cached && cached.lat != null && cached.lng != null) {
    return { lat: cached.lat, lng: cached.lng };
  }

  const miss = await prisma.cityCenterMissCache.findUnique({ where: { cityName } });
  if (miss && Date.now() - miss.updatedAt.getTime() < CITY_MISS_TTL_MS) return null;

  // A city-center lookup only feeds locationBias (a ranking hint, not a hard
  // requirement) — if the Places API itself is down, degrade to "no bias"
  // rather than surfacing the failure here; the caller that actually needs to
  // report a real error (the direct search a user triggers) sees it via its
  // own searchPlaceText call instead.
  let place: TextSearchPlace | null;
  try {
    place = await searchPlaceText(cityName, apiKey);
  } catch (err) {
    if (err instanceof PlacesApiError) return null;
    throw err;
  }
  if (!place) {
    await prisma.cityCenterMissCache.upsert({
      where: { cityName },
      create: { cityName },
      update: { updatedAt: new Date() },
    });
    return null;
  }

  await upsertPlace(cacheKey, {
    placeId: place.id,
    name: place.displayName.text,
    address: place.formattedAddress,
    lat: place.location.latitude,
    lng: place.location.longitude,
    rating: place.rating ?? null,
  });

  return { lat: place.location.latitude, lng: place.location.longitude };
}

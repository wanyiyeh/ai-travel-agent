import { lookupByQuery, upsertPlace } from "@/lib/placeCache";
import { haversineKm } from "@/lib/distanceMatrix";

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

export interface TextSearchPlace {
  id: string;
  displayName: { text: string };
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  rating?: number;
  priceLevel?: string;
  photos?: { name: string; widthPx?: number; heightPx?: number }[];
}

// `photos` is a Pro-tier field, same tier as `rating`/`priceLevel` are
// Enterprise-tier — since the mask already has Enterprise fields, the whole
// request bills at Enterprise regardless, so adding `photos` here doesn't
// add cost. It only returns photo *metadata* (a resource name); the actual
// image bytes are a separate billable call via the Photo Media endpoint.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.priceLevel",
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

export async function searchPlaceText(
  query: string,
  apiKey: string,
  locationBias?: { lat: number; lng: number } | null,
): Promise<TextSearchPlace | null> {
  const res = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 1,
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
    }),
  });

  if (!res.ok) return null;
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

  const place = await searchPlaceText(cityName, apiKey);
  if (!place) return null;

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

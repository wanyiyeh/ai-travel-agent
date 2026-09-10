import { NextResponse } from "next/server";
import { z } from "zod";
import { searchPlaceText, getCityCenter, PlacesApiError, type TextSearchPlace } from "@/lib/placesTextSearch";
import { nearestCity } from "@/lib/nearestCity";
import { haversineKm, MAX_PLAUSIBLE_DISTANCE_KM } from "@/lib/distanceMatrix";
import { PRICE_LEVEL_MAP } from "@/lib/fetchCityRestaurants";

const RequestSchema = z.object({
  query: z.string().min(1),
  // When provided, biases results toward this city (e.g. searching
  // "LEGOLAND" with cityHint "名古屋") and rejects far-away homonyms —
  // see REJECT_KM_THRESHOLD in placesTextSearch.ts.
  cityHint: z.string().optional(),
  // When provided (restructure flow's attraction search), the response also
  // includes which of these cities the found place is nearest to — lets the
  // frontend auto-assign a searched attraction to a city instead of asking.
  candidateCities: z.array(z.string()).optional(),
});

// Resolves the place a search query refers to — either biased toward every
// candidate city (attraction search) or toward a single cityHint (plain
// search). Throws PlacesApiError if the Places API request itself fails, so
// the caller can tell that apart from a genuine "no such place".
async function resolvePlace(
  query: string,
  cityHint: string | undefined,
  candidateCities: string[] | undefined,
  apiKey: string,
): Promise<TextSearchPlace | null> {
  if (candidateCities && candidateCities.length > 0) {
    // Attraction search: an unbiased text search's single "best match" can
    // land on a same-named/generic place near an entirely different city
    // than any of the ones the user has actually added (e.g. a Tokyo trip's
    // attraction search surfacing a same-named spot in Taipei). Bias against
    // every candidate city instead and keep whichever result lands closest
    // to the city it was biased toward.
    const centers = await Promise.all(
      candidateCities.map(async (city) => ({ city, center: await getCityCenter(city, apiKey) })),
    );
    const biased = await Promise.all(
      centers
        .filter((c): c is { city: string; center: { lat: number; lng: number } } => c.center !== null)
        .map(async ({ center }) => {
          const found = await searchPlaceText(query, apiKey, center);
          if (!found) return null;
          const distanceKm = haversineKm(found.location.latitude, found.location.longitude, center.lat, center.lng);
          return { place: found, distanceKm };
        }),
    );
    const best = biased
      .filter((r): r is { place: TextSearchPlace; distanceKm: number } => r !== null)
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];
    // Fall back to an unbiased search if nothing turned up near any
    // candidate city, so a legitimately-distant/ambiguous attraction still
    // surfaces something rather than a hard "not found" — the frontend's
    // nearestCity threshold check below sends those to manual disambiguation.
    return best ? best.place : await searchPlaceText(query, apiKey);
  }

  // No cityHint and no candidateCities means this is the restructure flow's
  // "add a city" search (RestructurePanel's city mode never sends either) —
  // restrict to locality results so an unrelated business/attraction can't
  // win on pure text similarity to an unmatched query (e.g. a garbled city
  // name text-matching a same-sounding shop name with no location bias to
  // rule it out).
  if (!cityHint) {
    return searchPlaceText(query, apiKey, null, "locality");
  }

  const locationBias = await getCityCenter(cityHint, apiKey);
  return searchPlaceText(query, apiKey, locationBias);
}

// Backs both "search a city to add" (no candidateCities) and "search a named
// attraction" (candidateCities = the trip's cities, used to bias the search
// and then classify the match) in the restructure flow's place-search step.
export async function POST(request: Request) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 503 });
  }

  const body = await request.json();
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const { query, cityHint, candidateCities } = parsed.data;

  let place: TextSearchPlace | null;

  try {
    place = await resolvePlace(query, cityHint, candidateCities, apiKey);
  } catch (err) {
    if (err instanceof PlacesApiError) {
      return NextResponse.json(
        { place: null, nearestCity: null, error: "Google 地圖服務暫時無法使用（額度已用盡或發生錯誤），請稍後再試" },
        { status: 503 },
      );
    }
    throw err;
  }

  const nearest =
    place && candidateCities && candidateCities.length > 0
      ? await nearestCity({ lat: place.location.latitude, lng: place.location.longitude }, candidateCities, apiKey)
      : null;

  // The match isn't just ambiguous between candidate cities — it's nowhere
  // near any of them, so it almost certainly isn't part of this trip (e.g.
  // searching "Paris" while restructuring a Kathmandu-only itinerary). Reject
  // it outright rather than letting the frontend offer manual disambiguation,
  // which would otherwise let a user pin it onto any city they click.
  if (nearest && nearest.distanceKm > MAX_PLAUSIBLE_DISTANCE_KM) {
    return NextResponse.json({
      place: null,
      nearestCity: null,
      error: `這個景點距離你行程中的城市都太遠（最近的「${nearest.city}」也有 ${Math.round(nearest.distanceKm)} 公里），可能不屬於這趟旅程`,
    });
  }

  // Google reports priceLevel as an enum string ("PRICE_LEVEL_MODERATE" etc.)
  // — map it to the same 0-4 number used everywhere else (priceLevelCost.ts,
  // fetchCityRestaurants.ts) so the frontend can carry it straight through to
  // the restructure API's estimateAttractionCost without its own copy of the
  // mapping table.
  const responsePlace = place
    ? { ...place, priceLevel: place.priceLevel ? (PRICE_LEVEL_MAP[place.priceLevel] ?? null) : null }
    : null;

  return NextResponse.json({ place: responsePlace, nearestCity: nearest });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { searchPlaceText, getCityCenter, type TextSearchPlace } from "@/lib/placesTextSearch";
import { nearestCity } from "@/lib/nearestCity";
import { haversineKm } from "@/lib/distanceMatrix";

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
    place = best ? best.place : await searchPlaceText(query, apiKey);
  } else {
    const locationBias = cityHint ? await getCityCenter(cityHint, apiKey) : null;
    place = await searchPlaceText(query, apiKey, locationBias);
  }

  const nearest =
    place && candidateCities && candidateCities.length > 0
      ? await nearestCity({ lat: place.location.latitude, lng: place.location.longitude }, candidateCities, apiKey)
      : null;

  return NextResponse.json({ place, nearestCity: nearest });
}

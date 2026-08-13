import { NextResponse } from "next/server";
import { z } from "zod";
import { searchPlaceText, getCityCenter } from "@/lib/placesTextSearch";
import { nearestCity } from "@/lib/nearestCity";

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

// Backs both "search a city to add" (no cityHint) and "search a named
// attraction" (cityHint = the city it should belong to) in the restructure
// flow's place-search step.
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

  const locationBias = cityHint ? await getCityCenter(cityHint, apiKey) : null;
  const place = await searchPlaceText(query, apiKey, locationBias);

  const nearest =
    place && candidateCities && candidateCities.length > 0
      ? await nearestCity({ lat: place.location.latitude, lng: place.location.longitude }, candidateCities, apiKey)
      : null;

  return NextResponse.json({ place, nearestCity: nearest });
}

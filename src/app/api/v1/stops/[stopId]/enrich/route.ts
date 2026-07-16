import { NextResponse } from "next/server";
import { prisma, j } from "@/lib/db";
import { lookupByQuery, lookupByPlaceId, upsertPlace } from "@/lib/placeCache";
import { searchPlaceText, getCityCenter } from "@/lib/placesTextSearch";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stopId: string }> }
) {
  try {
    const { stopId } = await params;
    const body = await request.json();
    const { itineraryId, context } = body;

    if (!itineraryId) {
      return NextResponse.json(
        { error: "itineraryId is required" },
        { status: 400 }
      );
    }

    const itinerary = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
    });

    if (!itinerary) {
      return NextResponse.json(
        { error: "Itinerary not found" },
        { status: 404 }
      );
    }

    const days = itinerary.days as Record<string, unknown>[];
    let targetStop: Record<string, unknown> | null = null;
    let cityHint = "";

    for (const day of days) {
      const stops = day.stops as Record<string, unknown>[];
      if (!stops) continue;
      const stopIndex = stops.findIndex((s) => s.id === stopId);
      if (stopIndex >= 0) {
        targetStop = stops[stopIndex];
        // Prefer waypointCity (set by tagWaypointCities), fall back to transitTo
        const departureCityHint =
          (typeof day.waypointCity === "string" ? day.waypointCity : "") ||
          (typeof day.transitTo === "string" ? day.transitTo : "") ||
          "";
        // On a transit day, only the first stop is the departure->arrival journey
        // itself; every later stop is required to be in the arrival city (see
        // itineraryGen.ts's generation prompt), so it must be geocoded against
        // transitTo rather than the departure-tagged waypointCity.
        const arrivalCityHint = typeof day.transitTo === "string" ? day.transitTo : "";
        cityHint =
          day.isTransitDay === true && stopIndex > 0 && arrivalCityHint
            ? arrivalCityHint
            : departureCityHint;
        break;
      }
    }

    if (!targetStop) {
      return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    }

    // Early return if already fully enriched
    if (targetStop.placeId && targetStop.lat && targetStop.lng) {
      return NextResponse.json({
        success: true,
        placeId: targetStop.placeId,
        lat: targetStop.lat,
        lng: targetStop.lng,
        address: targetStop.address ?? null,
        rating: targetStop.rating ?? null,
      });
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 503 });
    }

    // District-constrained query: name + district (if the AI filled it in) + city hint.
    // The district disambiguates same-named landmarks split across a city's
    // wards/neighborhoods (see itineraryGen.ts rule 20) — city name alone isn't
    // granular enough for cities like Tokyo or Kyoto.
    const district = typeof targetStop.district === "string" ? targetStop.district : "";
    const namePart = district ? `${targetStop.name} ${district}` : String(targetStop.name);
    const query = cityHint
      ? `${namePart} ${cityHint}`
      : context
      ? `${namePart} ${context}`
      : namePart;

    // Bias results toward the day's city so vague/generic stop names (e.g.
    // "咖啡文化體驗") don't resolve to a same-keyword place elsewhere in the
    // world — the city name in `query` alone is only a ranking hint, not a
    // geographic restriction.
    const cityBias = await getCityCenter(cityHint || context || "", apiKey);

    // Check Place cache before hitting Google API
    let enriched: { placeId: string; lat: number; lng: number; address: string | null; rating: number | null };

    const cached = await lookupByQuery(query);
    if (cached && cached.lat != null && cached.lng != null) {
      enriched = { placeId: cached.placeId, lat: cached.lat, lng: cached.lng, address: cached.address, rating: cached.rating };
    } else if (targetStop.placeId) {
      const cachedById = await lookupByPlaceId(String(targetStop.placeId));
      if (cachedById && cachedById.lat != null && cachedById.lng != null) {
        enriched = { placeId: cachedById.placeId, lat: cachedById.lat, lng: cachedById.lng, address: cachedById.address, rating: cachedById.rating };
      } else {
        const place = await searchPlaceText(query, apiKey, cityBias);
        if (!place) {
          return NextResponse.json({ error: "Place not found on Google Maps" }, { status: 404 });
        }
        enriched = { placeId: place.id, lat: place.location.latitude, lng: place.location.longitude, address: place.formattedAddress, rating: place.rating ?? null };
        await upsertPlace(query, { placeId: place.id, name: place.displayName.text, address: place.formattedAddress, lat: place.location.latitude, lng: place.location.longitude, rating: place.rating });
      }
    } else {
      const place = await searchPlaceText(query, apiKey, cityBias);
      if (!place) {
        return NextResponse.json({ error: "Place not found on Google Maps" }, { status: 404 });
      }
      enriched = { placeId: place.id, lat: place.location.latitude, lng: place.location.longitude, address: place.formattedAddress, rating: place.rating ?? null };
      await upsertPlace(query, { placeId: place.id, name: place.displayName.text, address: place.formattedAddress, lat: place.location.latitude, lng: place.location.longitude, rating: place.rating });
    }

    for (const day of days) {
      const stops = day.stops as Record<string, unknown>[];
      if (!stops) continue;
      const idx = stops.findIndex((s) => s.id === stopId);
      if (idx >= 0) {
        stops[idx] = { ...stops[idx], ...enriched };
        break;
      }
    }

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ success: true, ...enriched });
  } catch (error) {
    console.error("[Stop Enrich Error]", error);
    return NextResponse.json(
      { error: "Failed to enrich stop", details: String(error) },
      { status: 500 }
    );
  }
}

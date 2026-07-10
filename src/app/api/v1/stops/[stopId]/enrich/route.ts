import { NextResponse } from "next/server";
import { prisma, j } from "@/lib/db";
import { lookupByQuery, lookupByPlaceId, upsertPlace } from "@/lib/placeCache";

const PLACES_API_URL = "https://places.googleapis.com/v1/places:searchText";

interface PlaceResult {
  id: string;
  displayName: { text: string };
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  rating?: number;
}

async function searchPlace(query: string): Promise<PlaceResult | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY not configured");

  const res = await fetch(PLACES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.rating",
      ].join(","),
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });

  if (!res.ok) throw new Error(`Places API error: ${res.status}`);

  const data = await res.json();
  return data.places?.[0] ?? null;
}

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

    // City-constrained query: waypointCity > legacy context param > bare name
    const query = cityHint
      ? `${targetStop.name} ${cityHint}`
      : context
      ? `${targetStop.name} ${context}`
      : String(targetStop.name);

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
        const place = await searchPlace(query);
        if (!place) {
          return NextResponse.json({ error: "Place not found on Google Maps" }, { status: 404 });
        }
        enriched = { placeId: place.id, lat: place.location.latitude, lng: place.location.longitude, address: place.formattedAddress, rating: place.rating ?? null };
        await upsertPlace(query, { placeId: place.id, name: place.displayName.text, address: place.formattedAddress, lat: place.location.latitude, lng: place.location.longitude, rating: place.rating });
      }
    } else {
      const place = await searchPlace(query);
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

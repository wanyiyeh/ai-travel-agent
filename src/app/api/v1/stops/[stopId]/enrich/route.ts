import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const PLACES_API_URL = "https://places.googleapis.com/v1/places:searchText";

interface PlaceResult {
  id: string;
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  rating?: number;
  regularOpeningHours?: { weekdayDescriptions: string[] };
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
        "places.formattedAddress",
        "places.location",
        "places.rating",
        "places.regularOpeningHours",
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

    for (const day of days) {
      const stops = day.stops as Record<string, unknown>[];
      if (!stops) continue;
      const stop = stops.find((s) => s.id === stopId);
      if (stop) {
        targetStop = stop;
        break;
      }
    }

    if (!targetStop) {
      return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    }

    const query = context
      ? `${targetStop.name} ${context}`
      : String(targetStop.name);

    const place = await searchPlace(query);

    if (!place) {
      return NextResponse.json(
        { error: "Place not found on Google Maps" },
        { status: 404 }
      );
    }

    for (const day of days) {
      const stops = day.stops as Record<string, unknown>[];
      if (!stops) continue;
      const idx = stops.findIndex((s) => s.id === stopId);
      if (idx >= 0) {
        stops[idx] = {
          ...stops[idx],
          placeId: place.id,
          lat: place.location.latitude,
          lng: place.location.longitude,
          address: place.formattedAddress,
          rating: place.rating ?? null,
          openingHours: place.regularOpeningHours
            ? JSON.stringify(place.regularOpeningHours.weekdayDescriptions)
            : null,
        };
        break;
      }
    }

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: days as object[] },
    });

    return NextResponse.json({
      success: true,
      placeId: place.id,
      lat: place.location.latitude,
      lng: place.location.longitude,
      address: place.formattedAddress,
      rating: place.rating ?? null,
    });
  } catch (error) {
    console.error("[Stop Enrich Error]", error);
    return NextResponse.json(
      { error: "Failed to enrich stop", details: String(error) },
      { status: 500 }
    );
  }
}

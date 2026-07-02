import { NextResponse } from "next/server";
import { prisma, j } from "@/lib/db";
import { lookupByQuery, upsertPlace } from "@/lib/placeCache";

const PLACES_API_URL = "https://places.googleapis.com/v1/places:searchText";

async function searchPlace(query: string) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY not configured");

  const res = await fetch(PLACES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.places?.[0] ?? null;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const itinerary = await prisma.itinerary.findUnique({ where: { id } });
    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    let enrichedCount = 0;
    let cachedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const day of days) {
      const stops = day.stops as Record<string, unknown>[] | undefined;
      if (!stops) continue;

      const cityHint =
        (typeof day.waypointCity === "string" ? day.waypointCity : "") ||
        (typeof day.transitTo === "string" ? day.transitTo : "") ||
        "";

      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];

        // Already fully enriched
        if (stop.placeId && stop.lat && stop.lng) {
          skippedCount++;
          continue;
        }

        const query = cityHint
          ? `${stop.name} ${cityHint}`
          : String(stop.name);

        try {
          const cached = await lookupByQuery(query);
          if (cached && cached.lat != null && cached.lng != null) {
            stops[i] = {
              ...stop,
              placeId: cached.placeId,
              lat: cached.lat,
              lng: cached.lng,
              address: cached.address,
              rating: cached.rating,
            };
            cachedCount++;
          } else {
            const place = await searchPlace(query);
            if (!place) {
              failedCount++;
              continue;
            }
            stops[i] = {
              ...stop,
              placeId: place.id,
              lat: place.location.latitude,
              lng: place.location.longitude,
              address: place.formattedAddress,
              rating: place.rating ?? null,
            };
            await upsertPlace(query, {
              placeId: place.id,
              name: place.displayName.text,
              address: place.formattedAddress,
              lat: place.location.latitude,
              lng: place.location.longitude,
              rating: place.rating,
            });
            enrichedCount++;
          }
        } catch {
          failedCount++;
        }
      }
    }

    await prisma.itinerary.update({
      where: { id },
      data: { days: j(days) },
    });

    return NextResponse.json({
      success: true,
      enriched: enrichedCount,
      cached: cachedCount,
      skipped: skippedCount,
      failed: failedCount,
    });
  } catch (error) {
    console.error("[Enrich All Stops Error]", error);
    return NextResponse.json(
      { error: "Failed to enrich stops", details: String(error) },
      { status: 500 }
    );
  }
}

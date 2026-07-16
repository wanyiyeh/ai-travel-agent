import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { StopCandidateSchema } from "@/lib/schemas";
import { lookupByQuery, upsertPlace } from "@/lib/placeCache";
import { searchPlaceText, getCityCenter } from "@/lib/placesTextSearch";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
  stopName: z.string().min(1),
});

const BatchRequestSchema = z.object({
  itineraryId: z.string().min(1),
  stops: z.array(StopCandidateSchema).min(1),
});

// Default stay length for a manually-added stop — same fallback used by
// stop-suggestions/route.ts for candidates without an AI-estimated duration;
// user can adjust it after adding.
const DEFAULT_DURATION_MINUTES = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dayId: string }> }
) {
  try {
    const { dayId } = await params;
    const body = await request.json();

    // Batch path: pre-resolved candidates (from stop-suggestions or another
    // day's already-enriched stops) — no LLM call, write geo fields as-is.
    if (Array.isArray((body as Record<string, unknown>)?.stops)) {
      const parsedBatch = BatchRequestSchema.safeParse(body);
      if (!parsedBatch.success) {
        return NextResponse.json(
          { error: "Invalid request", details: parsedBatch.error.flatten() },
          { status: 400 }
        );
      }

      const { itineraryId, stops: candidates } = parsedBatch.data;

      const itinerary = await prisma.itinerary.findUnique({
        where: { id: itineraryId },
      });
      if (!itinerary) {
        return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
      }

      const days = itinerary.days as Record<string, unknown>[];
      const dayIndex = days.findIndex((d) => d.id === dayId);
      if (dayIndex === -1) {
        return NextResponse.json({ error: "Day not found" }, { status: 404 });
      }

      const stops = (days[dayIndex].stops as Record<string, unknown>[]) ?? [];
      const newStops = candidates.map((c, i) => ({
        id: crypto.randomUUID(),
        name: c.name,
        description: c.description,
        duration_minutes: c.duration_minutes,
        orderIndex: stops.length + i,
        ...(c.placeId
          ? { placeId: c.placeId, lat: c.lat, lng: c.lng, address: c.address, rating: c.rating ?? null }
          : {}),
      }));

      (days[dayIndex].stops as Record<string, unknown>[]).push(...newStops);

      await prisma.itinerary.update({
        where: { id: itineraryId },
        data: { days: j(days) },
      });

      return NextResponse.json({ stops: newStops });
    }

    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { itineraryId, stopName } = parsed.data;

    const itinerary = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
    });

    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const dayIndex = days.findIndex((d) => d.id === dayId);

    if (dayIndex === -1) {
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }

    const day = days[dayIndex];
    const stops = (day.stops as Record<string, unknown>[]) ?? [];

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 503 });
    }

    // Same city-hint fallback chain as stops/[stopId]/enrich — biases the
    // text search toward the day's actual city so a generic name doesn't
    // resolve to a same-named place elsewhere.
    const cityHint =
      (typeof day.waypointCity === "string" ? day.waypointCity : "") ||
      (typeof day.transitTo === "string" ? day.transitTo : "") ||
      "";
    const query = cityHint ? `${stopName} ${cityHint}` : stopName;

    let resolved: { placeId: string; name: string; lat: number; lng: number; address: string | null; rating: number | null };

    const cached = await lookupByQuery(query);
    if (cached && cached.lat != null && cached.lng != null) {
      resolved = { placeId: cached.placeId, name: cached.name, lat: cached.lat, lng: cached.lng, address: cached.address, rating: cached.rating };
    } else {
      const cityBias = await getCityCenter(cityHint, apiKey);
      const place = await searchPlaceText(query, apiKey, cityBias);
      if (!place) {
        return NextResponse.json(
          { error: "在 Google 地圖上找不到這個地點，請確認名稱是否正確" },
          { status: 404 }
        );
      }
      resolved = {
        placeId: place.id,
        name: place.displayName.text,
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
    }

    const newStop = {
      id: crypto.randomUUID(),
      name: resolved.name,
      description: resolved.rating ? `Google 評分 ${resolved.rating}★` : resolved.address ?? "",
      duration_minutes: DEFAULT_DURATION_MINUTES,
      placeId: resolved.placeId,
      lat: resolved.lat,
      lng: resolved.lng,
      address: resolved.address,
      rating: resolved.rating,
      orderIndex: stops.length,
    };

    (days[dayIndex].stops as Record<string, unknown>[]).push(newStop);

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ stop: newStop });
  } catch (error) {
    console.error("[Add Stop Error]", error);
    return NextResponse.json(
      { error: "Failed to add stop", details: String(error) },
      { status: 500 }
    );
  }
}

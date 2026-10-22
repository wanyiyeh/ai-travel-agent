import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { iataToCity } from "@/lib/iataCity";
import { lookupByQuery, upsertPlace } from "@/lib/placeCache";
import { resolvePlace, getCityCenter } from "@/lib/placesTextSearch";
import { estimateLodgingCostPerNight, estimateLodgingCostRange } from "@/lib/priceLevelCost";
import { findDayIndex } from "@/lib/itineraryDays";
import { isRecentEnrichFailure, enrichFailureMarker } from "@/lib/enrichFailure";
import { MAX_NAME_LENGTH } from "@/lib/inputLimits";
import { internalErrorResponse } from "@/lib/apiError";
import { authorizeItinerary } from "@/lib/auth/ownership";
import { hydratePlacesMetered } from "@/lib/placeDisplay";

const RequestSchema = z.object({ itineraryId: z.string().min(1).max(MAX_NAME_LENGTH) });

// Re-reads the itinerary right before writing (the caller's Text Search call
// can take a while, and other enrich routes may have saved in the meantime) so
// this only touches the one day's marker instead of clobbering newer data.
async function markAccommodationNotFound(itineraryId: string, dayId: string, query: string) {
  const fresh = await prisma.itinerary.findUnique({ where: { id: itineraryId } });
  if (!fresh) return;
  const days = fresh.days as Record<string, unknown>[];
  const idx = findDayIndex(days, dayId);
  const acc = idx === -1 ? undefined : (days[idx].accommodation as Record<string, unknown> | undefined);
  if (!acc) return;
  days[idx] = { ...days[idx], accommodation: { ...acc, enrichFailure: enrichFailureMarker(query, "not_found") } };
  await prisma.itinerary.update({ where: { id: itineraryId }, data: { days: j(days) } });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dayId: string }> }
) {
  try {
    const { dayId } = await params;
    const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { itineraryId } = parsed.data;

    const access = await authorizeItinerary(itineraryId);
    if (!access.ok) return access.response;
    const { itinerary } = access;

    const days = itinerary.days as Record<string, unknown>[];
    const dayIndex = findDayIndex(days, dayId);

    if (dayIndex === -1) {
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }

    const day = days[dayIndex];
    const accommodation = day.accommodation as Record<string, unknown> | undefined;

    if (!accommodation) {
      return NextResponse.json({ error: "No accommodation for this day" }, { status: 404 });
    }

    // noneFound: no stay was suggested (no pet-friendly lodging nearby) —
    // looking up the area's name would put any hotel there.
    if (accommodation.placeId || accommodation.noneFound) {
      // Stored with its place ID only (ADR-0004); the page merges this in.
      await hydratePlacesMetered([accommodation]);
      return NextResponse.json({ success: true, accommodation });
    }

    const config = itinerary.config as {
      flightInfo?: { arrivalCity?: string };
      currency?: string;
    };

    const accName = typeof accommodation.name === "string" ? accommodation.name : undefined;
    const accArea = typeof accommodation.area === "string" ? accommodation.area : undefined;

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 503 });
    }

    // Derive city name to search around. Transit days sleep in transitTo that
    // night, not the day's own waypointCity (which is where the day's stops —
    // i.e. the departure point — are), so prefer transitTo for those.
    const transitTo = typeof day.transitTo === "string" ? day.transitTo : undefined;
    const waypointCity = typeof day.waypointCity === "string" ? day.waypointCity : undefined;
    const iataCity = config.flightInfo?.arrivalCity
      ? iataToCity(config.flightInfo.arrivalCity)
      : undefined;
    const cityHint = (day.isTransitDay ? transitTo : undefined) ?? waypointCity ?? iataCity ?? "";

    // Build a precise query: prefer hotel name, fall back to "hotel in area, city"
    const query = accName
      ? `${accName} ${accArea ?? ""} ${cityHint}`.trim()
      : `hotel ${accArea ?? ""} ${cityHint}`.trim();

    // Same query already failed recently — answer from the marker instead of
    // re-billing Google (both EditableItineraryCard and ItineraryMap call this
    // for every unresolved accommodation on every page open).
    if (isRecentEnrichFailure(accommodation, query)) {
      return NextResponse.json({ error: "Accommodation not found on Google Maps" }, { status: 404 });
    }

    const cityBias = await getCityCenter(cityHint, apiKey);

    // The cache keeps the place ID and coordinates only (ADR-0004); anything
    // else comes from resolvePlace's two cheap calls on a miss.
    const cached = await lookupByQuery(query);
    let found: { placeId: string; lat: number; lng: number; address: string | null };
    if (cached && cached.lat != null && cached.lng != null) {
      found = { placeId: cached.placeId, lat: cached.lat, lng: cached.lng, address: null };
    } else {
      const place = await resolvePlace(query, apiKey, cityBias);
      if (!place) {
        await markAccommodationNotFound(itineraryId, dayId, query);
        return NextResponse.json(
          { error: "Accommodation not found on Google Maps" },
          { status: 404 }
        );
      }
      found = place;
      await upsertPlace(query, { placeId: place.placeId, lat: place.lat, lng: place.lng });
    }

    // Price level is an Enterprise field and was never asked for here, so
    // the estimate is the currency's default either way.
    const estimatedCost = estimateLodgingCostPerNight(config.currency, null);
    const costRange = estimateLodgingCostRange(config.currency, null);

    const enriched: Record<string, unknown> = {
      ...accommodation,
      enrichFailure: undefined,
      ...(accName ? { name: accName } : {}),
      placeId: found.placeId,
      lat: found.lat,
      lng: found.lng,
      ...(found.address ? { address: found.address } : {}),
      ...(estimatedCost !== undefined ? { estimated_cost: estimatedCost } : {}),
      ...(costRange !== undefined
        ? { estimated_cost_low: costRange[0], estimated_cost_high: costRange[1] }
        : {}),
    };

    days[dayIndex] = { ...day, accommodation: enriched };

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    // Lodging generated as an area only now has a hotel; the page shows its
    // name, fetched after the write so it isn't stored (ADR-0004).
    await hydratePlacesMetered([enriched]);
    return NextResponse.json({ success: true, accommodation: enriched });
  } catch (error) {
    return internalErrorResponse("Accommodation Enrich Error", error, "Failed to enrich accommodation");
  }
}

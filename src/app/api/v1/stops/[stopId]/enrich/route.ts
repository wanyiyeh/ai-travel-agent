import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { lookupByQuery, lookupByPlaceId, upsertPlace } from "@/lib/placeCache";
import { resolvePlace, fetchPlaceEssentials, getCityCenter, buildStopQuery } from "@/lib/placesTextSearch";
import { findStopAcrossDays, getCityHintForDay } from "@/lib/itineraryDays";
import { isRecentEnrichFailure, enrichFailureMarker } from "@/lib/enrichFailure";
import { MAX_NAME_LENGTH } from "@/lib/inputLimits";
import { internalErrorResponse } from "@/lib/apiError";
import { authorizeItinerary } from "@/lib/auth/ownership";
import { hydratePlacesMetered } from "@/lib/placeDisplay";

// `context` (the trip's destination city) becomes part of a Google Text
// Search query and a city-center lookup, so it's capped like any name.
const RequestSchema = z.object({
  itineraryId: z.string().min(1).max(MAX_NAME_LENGTH),
  context: z.string().max(MAX_NAME_LENGTH).nullable().optional(),
});

// Re-reads the itinerary right before writing (the caller's Text Search call
// can take a while, and enrich-all-stops may have saved in the meantime) so this
// only touches the one stop's marker instead of clobbering newer days data.
async function markStopNotFound(itineraryId: string, stopId: string, query: string) {
  const fresh = await prisma.itinerary.findUnique({ where: { id: itineraryId } });
  if (!fresh) return;
  const days = fresh.days as Record<string, unknown>[];
  const location = findStopAcrossDays(days, stopId);
  if (!location) return;
  const stops = location.day.stops as Record<string, unknown>[];
  stops[location.stopIndex] = { ...stops[location.stopIndex], enrichFailure: enrichFailureMarker(query, "not_found") };
  await prisma.itinerary.update({ where: { id: itineraryId }, data: { days: j(days) } });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stopId: string }> }
) {
  try {
    const { stopId } = await params;
    const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { itineraryId, context } = parsed.data;

    const access = await authorizeItinerary(itineraryId);
    if (!access.ok) return access.response;
    const { itinerary } = access;

    const days = itinerary.days as Record<string, unknown>[];
    const location = findStopAcrossDays(days, stopId);

    if (!location) {
      return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    }

    const targetStop = (location.day.stops as Record<string, unknown>[])[location.stopIndex];
    const cityHint = getCityHintForDay(location.day, location.stopIndex);

    // Early return if already fully enriched
    if (targetStop.placeId && targetStop.lat && targetStop.lng) {
      // Stored with its place ID only (ADR-0004); the map writes these
      // fields onto the stop, so a missing address mustn't blank it.
      await hydratePlacesMetered([targetStop]);
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
    const query = buildStopQuery(String(targetStop.name), district, cityHint || context || "");

    // Same query already failed recently — answer from the marker instead of
    // re-billing Google (ItineraryMap calls this for every unresolved stop on
    // every page open).
    if (isRecentEnrichFailure(targetStop, query)) {
      return NextResponse.json({ error: "Place not found on Google Maps" }, { status: 404 });
    }

    // Bias results toward the day's city so vague/generic stop names (e.g.
    // "咖啡文化體驗") don't resolve to a same-keyword place elsewhere in the
    // world — the city name in `query` alone is only a ranking hint, not a
    // geographic restriction.
    const cityBias = await getCityCenter(cityHint || context || "", apiKey);

    // The cache keeps the place ID and coordinates only (ADR-0004). A stop
    // that already has a place ID only needs its coordinates back (Place
    // Details Essentials); one without is found with resolvePlace.
    let enriched: { placeId: string; lat: number; lng: number };

    const cached = await lookupByQuery(query);
    const cachedById = !cached && targetStop.placeId ? await lookupByPlaceId(String(targetStop.placeId)) : null;
    const fresh = [cached, cachedById].find((c) => c && c.lat != null && c.lng != null);
    if (fresh) {
      enriched = { placeId: fresh.placeId, lat: fresh.lat!, lng: fresh.lng! };
    } else {
      const place = targetStop.placeId
        ? await fetchPlaceEssentials(String(targetStop.placeId), apiKey)
        : await resolvePlace(query, apiKey, cityBias);
      if (!place) {
        await markStopNotFound(itineraryId, stopId, query);
        return NextResponse.json({ error: "Place not found on Google Maps" }, { status: 404 });
      }
      enriched = { placeId: place.placeId, lat: place.lat, lng: place.lng };
      await upsertPlace(query, enriched);
    }

    const stops = location.day.stops as Record<string, unknown>[];
    stops[location.stopIndex] = { ...stops[location.stopIndex], ...enriched, enrichFailure: undefined };

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    // The map writes the returned address onto the stop; fetched after the
    // write, so it isn't stored.
    const [shown] = await hydratePlacesMetered([{ ...stops[location.stopIndex], name: undefined }]);
    return NextResponse.json({ success: true, ...enriched, address: (shown as { address?: string }).address ?? null });
  } catch (error) {
    return internalErrorResponse("Stop Enrich Error", error, "Failed to enrich stop");
  }
}

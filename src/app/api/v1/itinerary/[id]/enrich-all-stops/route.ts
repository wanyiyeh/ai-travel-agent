import { NextResponse } from "next/server";
import { prisma, j } from "@/lib/db";
import { lookupByQuery, upsertPlace } from "@/lib/placeCache";
import { resolvePlace, getCityCenter, buildStopQuery, buildMealQuery } from "@/lib/placesTextSearch";
import { haversineKm, centroid, SUSPICIOUS_DISTANCE_KM as SUSPICIOUS_KM } from "@/lib/distanceMatrix";
import { estimateMealCost } from "@/lib/priceLevelCost";
import { getCityHintForDay } from "@/lib/itineraryDays";
import { isRecentEnrichFailure, enrichFailureMarker } from "@/lib/enrichFailure";
import { internalErrorResponse } from "@/lib/apiError";
import { MEAL_TYPES } from "@/types/itinerary";
import { authorizeItinerary } from "@/lib/auth/ownership";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const access = await authorizeItinerary(id);
    if (!access.ok) return access.response;
    const { itinerary } = access;

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 503 });
    }

    const config = itinerary.config as { currency?: string };
    const currency = config.currency;

    const days = itinerary.days as Record<string, unknown>[];
    let enrichedCount = 0;
    let cachedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const suspiciousStops: { name: string; day: number; reason: string }[] = [];

    // Cache city-center lookups across the whole itinerary so repeat cities
    // (most days) only resolve once instead of once per stop/meal.
    const cityBiasCache = new Map<string, { lat: number; lng: number } | null>();
    async function biasFor(city: string, key: string): Promise<{ lat: number; lng: number } | null> {
      if (!city) return null;
      if (!cityBiasCache.has(city)) {
        cityBiasCache.set(city, await getCityCenter(city, key));
      }
      return cityBiasCache.get(city) ?? null;
    }

    for (const day of days) {
      const cityHint = getCityHintForDay(day);
      const cityBias = await biasFor(cityHint, apiKey);

      const meals = day.meals as Record<string, Record<string, unknown>> | undefined;

      if (meals) {
        for (const mealKey of MEAL_TYPES) {
          const meal = meals[mealKey];
          if (!meal) continue;

          const originalName = String(meal.name);

          // Already geocoded: nothing to do.
          if (meal.placeId) continue;

          const query = buildMealQuery(originalName, cityHint);

          // Unlike stops (checked against sibling-stop centroid below), a meal
          // has no siblings to compare against — so check it against the
          // day's city-center bias instead. Without this, Text Search can
          // silently resolve an AI-invented restaurant name to a same/similar
          // -named place in the wrong country (e.g. Beirut for a Cairo day)
          // since REJECT_KM_THRESHOLD in placesTextSearch.ts is 1500km, far
          // looser than what "same city" actually requires.
          const tooFarFromCity = (lat: number, lng: number): boolean =>
            !!cityBias && haversineKm(lat, lng, cityBias.lat, cityBias.lng) > SUSPICIOUS_KM;

          // Already tried this exact query recently and it failed — don't
          // re-bill Google on every page open. Keep surfacing a distance
          // rejection as a warning (free), same as when it first happened.
          if (isRecentEnrichFailure(meal, query)) {
            skippedCount++;
            if (meal.enrichFailure && (meal.enrichFailure as { reason?: string }).reason === "too_far") {
              suspiciousStops.push({
                name: originalName,
                day: typeof day.day === "number" ? day.day : 0,
                reason: `距 ${cityHint || "行程城市"} 過遠，未套用`,
              });
            }
            continue;
          }

          try {
            const cached = await lookupByQuery(query);
            if (cached && cached.lat != null && cached.lng != null) {
              if (tooFarFromCity(cached.lat, cached.lng)) {
                failedCount++;
                meals[mealKey] = { ...meal, enrichFailure: enrichFailureMarker(query, "too_far") };
                suspiciousStops.push({
                  name: originalName,
                  day: typeof day.day === "number" ? day.day : 0,
                  reason: `快取地點距 ${cityHint || "行程城市"} 過遠，未套用`,
                });
                continue;
              }
              meals[mealKey] = {
                ...meal,
                name: originalName,
                placeId: cached.placeId,
                lat: cached.lat,
                lng: cached.lng,
                enrichFailure: undefined,
              };
              cachedCount++;
            } else {
              const place = await resolvePlace(query, apiKey, cityBias);
              if (!place) {
                failedCount++;
                meals[mealKey] = { ...meal, enrichFailure: enrichFailureMarker(query, "not_found") };
                continue;
              }
              if (tooFarFromCity(place.lat, place.lng)) {
                failedCount++;
                meals[mealKey] = { ...meal, enrichFailure: enrichFailureMarker(query, "too_far") };
                suspiciousStops.push({
                  name: originalName,
                  day: typeof day.day === "number" ? day.day : 0,
                  reason: `距 ${cityHint || "行程城市"} 約 ${Math.round(
                    haversineKm(place.lat, place.lng, cityBias!.lat, cityBias!.lng),
                  )} km，地點可能搜尋有誤，未套用`,
                });
                continue;
              }
              const priceLevel = null; // Enterprise field, not fetched
              const estimatedCost = estimateMealCost(currency, mealKey, priceLevel);
              meals[mealKey] = {
                ...meal,
                name: originalName,
                placeId: place.placeId,
                lat: place.lat,
                lng: place.lng,
                address: place.address,
                enrichFailure: undefined,
                ...(estimatedCost !== undefined ? { estimated_cost: estimatedCost } : {}),
              };
              await upsertPlace(query, { placeId: place.placeId, lat: place.lat, lng: place.lng });
              enrichedCount++;
            }
          } catch {
            failedCount++;
          }
        }
      }

      const stops = day.stops as Record<string, unknown>[] | undefined;
      if (!stops) continue;

      const isTransitDay = day.isTransitDay === true;

      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];

        // Already fully enriched: nothing to do.
        if (stop.placeId && stop.lat && stop.lng) {
          skippedCount++;
          continue;
        }

        // On a transit day, only the first stop is the departure->arrival journey
        // itself; every later stop is required (by the generation prompt) to be
        // in the arrival city, so geocoding it against the departure-tagged
        // waypointCity can match an unrelated same-named place there instead.
        const stopCityHint = getCityHintForDay(day, i);

        // District disambiguates same-named landmarks split across a city's
        // wards/neighborhoods (see itineraryGen.ts rule 20) — city name alone
        // isn't granular enough for cities like Tokyo or Kyoto.
        const district = typeof stop.district === "string" ? stop.district : "";
        const originalName = String(stop.name);
        const query = buildStopQuery(originalName, district, stopCityHint);
        if (isRecentEnrichFailure(stop, query)) {
          skippedCount++;
          continue;
        }

        const stopBias = stopCityHint === cityHint ? cityBias : await biasFor(stopCityHint, apiKey);

        try {
          const cached = await lookupByQuery(query);
          let enrichedLat: number;
          let enrichedLng: number;
          let baseFields: Record<string, unknown>;

          if (cached && cached.lat != null && cached.lng != null) {
            enrichedLat = cached.lat;
            enrichedLng = cached.lng;
            baseFields = {
              name: originalName,
              placeId: cached.placeId,
              lat: cached.lat,
              lng: cached.lng,
            };
            cachedCount++;
          } else {
            const place = await resolvePlace(query, apiKey, stopBias);
            if (!place) {
              failedCount++;
              stops[i] = { ...stop, enrichFailure: enrichFailureMarker(query, "not_found") };
              continue;
            }
            enrichedLat = place.lat;
            enrichedLng = place.lng;
            baseFields = {
              name: originalName,
              placeId: place.placeId,
              lat: enrichedLat,
              lng: enrichedLng,
              address: place.address,
            };
            await upsertPlace(query, { placeId: place.placeId, lat: enrichedLat, lng: enrichedLng });
            enrichedCount++;
          }

          // Detect suspicious locations: compare to centroid of sibling stops
          let suspicious = false;
          let suspiciousReason: string | undefined;
          if (!isTransitDay) {
            const siblings = stops
              .filter((s, j) => j !== i && typeof s.lat === "number" && typeof s.lng === "number")
              .map((s) => ({ lat: s.lat as number, lng: s.lng as number }));
            if (siblings.length >= 1) {
              const c = centroid(siblings);
              const km = haversineKm(enrichedLat, enrichedLng, c.lat, c.lng);
              if (km > SUSPICIOUS_KM) {
                suspicious = true;
                suspiciousReason = `距同天其他景點約 ${Math.round(km)} km，地點可能搜尋有誤`;
                suspiciousStops.push({
                  name: originalName,
                  day: typeof day.day === "number" ? day.day : 0,
                  reason: suspiciousReason,
                });
              }
            }
          }

          stops[i] = {
            ...stop,
            ...baseFields,
            enrichFailure: undefined,
            ...(suspicious ? { suspicious: true, suspiciousReason } : { suspicious: undefined, suspiciousReason: undefined }),
          };
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
      suspicious: suspiciousStops.length,
      suspiciousStops,
    });
  } catch (error) {
    return internalErrorResponse("Enrich All Stops Error", error, "Failed to enrich stops");
  }
}

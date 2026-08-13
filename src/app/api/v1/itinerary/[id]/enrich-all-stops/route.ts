import { NextResponse } from "next/server";
import { prisma, j } from "@/lib/db";
import { lookupByQuery, upsertPlace } from "@/lib/placeCache";
import { searchPlaceText, getCityCenter, buildStopQuery, buildMealQuery } from "@/lib/placesTextSearch";
import { haversineKm } from "@/lib/distanceMatrix";
import { PRICE_LEVEL_MAP } from "@/lib/fetchCityRestaurants";
import { estimateMealCost } from "@/lib/priceLevelCost";

// If a stop is >80km from the centroid of its siblings, it's likely the wrong place
const SUSPICIOUS_KM = 80;

function centroid(pts: { lat: number; lng: number }[]): { lat: number; lng: number } {
  const sum = pts.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / pts.length, lng: sum.lng / pts.length };
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
      const cityHint =
        (typeof day.waypointCity === "string" ? day.waypointCity : "") ||
        (typeof day.transitTo === "string" ? day.transitTo : "") ||
        "";
      const cityBias = await biasFor(cityHint, apiKey);

      const meals = day.meals as Record<string, Record<string, unknown>> | undefined;
      if (meals) {
        for (const mealKey of ["breakfast", "lunch", "dinner", "snack"] as const) {
          const meal = meals[mealKey];
          if (!meal || meal.placeId) continue;

          const query = buildMealQuery(String(meal.name), cityHint);

          try {
            const cached = await lookupByQuery(query);
            if (cached && cached.lat != null && cached.lng != null) {
              meals[mealKey] = {
                ...meal,
                placeId: cached.placeId,
                lat: cached.lat,
                lng: cached.lng,
                address: cached.address,
                rating: cached.rating,
              };
              cachedCount++;
            } else {
              const place = await searchPlaceText(query, apiKey, cityBias);
              if (!place) {
                failedCount++;
                continue;
              }
              const priceLevel = place.priceLevel ? (PRICE_LEVEL_MAP[place.priceLevel] ?? null) : null;
              const estimatedCost = estimateMealCost(currency, mealKey, priceLevel);
              meals[mealKey] = {
                ...meal,
                placeId: place.id,
                lat: place.location.latitude,
                lng: place.location.longitude,
                address: place.formattedAddress,
                rating: place.rating ?? null,
                ...(estimatedCost !== undefined ? { estimated_cost: estimatedCost } : {}),
              };
              await upsertPlace(query, {
                placeId: place.id,
                name: place.displayName.text,
                address: place.formattedAddress,
                lat: place.location.latitude,
                lng: place.location.longitude,
                rating: place.rating,
                photoName: place.photos?.[0]?.name ?? null,
              });
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
      const arrivalCityHint = typeof day.transitTo === "string" ? day.transitTo : "";

      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];

        // Already fully enriched
        if (stop.placeId && stop.lat && stop.lng) {
          skippedCount++;
          continue;
        }

        // On a transit day, only the first stop is the departure->arrival journey
        // itself; every later stop is required (by the generation prompt) to be
        // in the arrival city, so geocoding it against the departure-tagged
        // waypointCity can match an unrelated same-named place there instead.
        const stopCityHint = isTransitDay && i > 0 && arrivalCityHint ? arrivalCityHint : cityHint;

        // District disambiguates same-named landmarks split across a city's
        // wards/neighborhoods (see itineraryGen.ts rule 20) — city name alone
        // isn't granular enough for cities like Tokyo or Kyoto.
        const district = typeof stop.district === "string" ? stop.district : "";
        const query = buildStopQuery(String(stop.name), district, stopCityHint);
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
              placeId: cached.placeId,
              lat: cached.lat,
              lng: cached.lng,
              address: cached.address,
              rating: cached.rating,
            };
            cachedCount++;
          } else {
            const place = await searchPlaceText(query, apiKey, stopBias);
            if (!place) {
              failedCount++;
              continue;
            }
            enrichedLat = place.location.latitude;
            enrichedLng = place.location.longitude;
            baseFields = {
              placeId: place.id,
              lat: enrichedLat,
              lng: enrichedLng,
              address: place.formattedAddress,
              rating: place.rating ?? null,
            };
            await upsertPlace(query, {
              placeId: place.id,
              name: place.displayName.text,
              address: place.formattedAddress,
              lat: enrichedLat,
              lng: enrichedLng,
              rating: place.rating,
              photoName: place.photos?.[0]?.name ?? null,
            });
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
                  name: String(stop.name),
                  day: typeof day.day === "number" ? day.day : 0,
                  reason: suspiciousReason,
                });
              }
            }
          }

          stops[i] = {
            ...stop,
            ...baseFields,
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
    console.error("[Enrich All Stops Error]", error);
    return NextResponse.json(
      { error: "Failed to enrich stops", details: String(error) },
      { status: 500 }
    );
  }
}

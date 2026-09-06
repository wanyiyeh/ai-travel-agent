import { NextResponse } from "next/server";
import { prisma, j } from "@/lib/db";
import { lookupByQuery, upsertPlace } from "@/lib/placeCache";
import { searchPlaceText, getCityCenter, buildStopQuery, buildMealQuery } from "@/lib/placesTextSearch";
import { haversineKm, centroid, SUSPICIOUS_DISTANCE_KM as SUSPICIOUS_KM } from "@/lib/distanceMatrix";
import { PRICE_LEVEL_MAP } from "@/lib/fetchCityRestaurants";
import { estimateMealCost } from "@/lib/priceLevelCost";
import { translatePlaceNames } from "@/lib/translatePlaceNames";
import { getCityHintForDay } from "@/lib/itineraryDays";

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
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const days = itinerary.days as Record<string, unknown>[];
    let enrichedCount = 0;
    let cachedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const suspiciousStops: { name: string; day: number; reason: string }[] = [];

    // Cache city-center lookups across the whole itinerary so repeat cities
    // (most days) only resolve once instead of once per stop/meal.
    // Kana (hiragana/katakana) is a reliable signal that a name is still
    // untranslated Japanese — kanji-only names are left alone since they may
    // already be valid, readable Chinese.
    const hasKana = (s: string) => /[぀-ヿ]/.test(s);

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
      const stopsForNames = day.stops as Record<string, unknown>[] | undefined;

      // The AI-generated name is copied verbatim from Google's Nearby Search
      // hints (see generate-stream/route.ts), which are only in Chinese when
      // Google happens to have a zh-TW listing for that specific place —
      // otherwise it's whatever local-script name Google returned. Translate
      // once per day, up front, for display only: the enrichment queries
      // below still search on the original name so place-matching isn't
      // affected by translation quality.
      const namesNeedingTranslation = [
        ...(meals
          ? (["breakfast", "lunch", "dinner", "snack"] as const)
              .map((k) => meals[k])
              .filter((m) => m && (!m.placeId || hasKana(String(m.name))))
              .map((m) => String(m!.name))
          : []),
        ...(stopsForNames ?? [])
          .filter((s) => !(s.placeId && s.lat && s.lng) || hasKana(String(s.name)))
          .map((s) => String(s.name)),
      ];
      const nameTranslations = await translatePlaceNames(
        [...new Set(namesNeedingTranslation)],
        model,
      );

      if (meals) {
        for (const mealKey of ["breakfast", "lunch", "dinner", "snack"] as const) {
          const meal = meals[mealKey];
          if (!meal) continue;

          const originalName = String(meal.name);
          const displayName = nameTranslations.get(originalName) ?? originalName;

          // Already geocoded — only backfill the display name (no re-search).
          if (meal.placeId) {
            if (displayName !== originalName) {
              meals[mealKey] = { ...meal, name: displayName };
            }
            continue;
          }

          const query = buildMealQuery(originalName, cityHint);

          try {
            const cached = await lookupByQuery(query);
            if (cached && cached.lat != null && cached.lng != null) {
              meals[mealKey] = {
                ...meal,
                name: displayName,
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
                name: displayName,
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

      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];

        // Already fully enriched — only backfill the display name (no re-search).
        if (stop.placeId && stop.lat && stop.lng) {
          const originalStopName = String(stop.name);
          const fixedName = nameTranslations.get(originalStopName) ?? originalStopName;
          if (fixedName !== originalStopName) {
            stops[i] = { ...stop, name: fixedName };
          }
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
        const displayName = nameTranslations.get(originalName) ?? originalName;
        const query = buildStopQuery(originalName, district, stopCityHint);
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
              name: displayName,
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
              name: displayName,
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
                  name: displayName,
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

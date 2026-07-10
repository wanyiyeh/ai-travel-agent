/**
 * Enrich all stops across every itinerary via Google Places API,
 * then write results to Place + PlaceQuery cache tables.
 *
 * Run: npm run enrich-all
 * Skip API and only write already-enriched stops to cache: npm run enrich-all -- --cache-only
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";

try {
  const envContent = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {}

const prisma = new PrismaClient();
const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";

// Some itineraries store an airport/city code instead of a geocodable name.
const CITY_HINT_ALIASES: Record<string, string> = {
  CPT: "Cape Town, South Africa",
  JNB: "Johannesburg, South Africa",
  高地: "Scottish Highlands, UK",
};

// City-hint text like "金門大橋" or "高地小鎮" can collide with an unrelated,
// identically-named place in Taiwan/Hong Kong. Biasing the search toward the
// destination city's coordinates (resolved once per city hint) stops Google
// from returning that homonym instead of the intended location.
const cityCenterCache = new Map<string, { lat: number; lng: number } | null>();

// Beyond this, locationBias clearly lost to a more "famous" homonym
// elsewhere (e.g. Hong Kong's 海洋公園 outranking a Bay Area search) —
// reject rather than cache a wrong-continent match. Kept generous so
// legitimate long road-trip days (LA -> Big Sur -> SF) aren't rejected.
const REJECT_KM_THRESHOLD = 1500;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function resolveCityCenter(cityHint: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
  if (!cityHint) return null;
  if (cityCenterCache.has(cityHint)) return cityCenterCache.get(cityHint)!;

  const query = CITY_HINT_ALIASES[cityHint] ?? cityHint;
  const place = await searchPlace(query, apiKey);
  const center = place?.location
    ? { lat: place.location.latitude, lng: place.location.longitude }
    : null;
  cityCenterCache.set(cityHint, center);
  return center;
}

async function searchPlace(
  query: string,
  apiKey: string,
  locationBias?: { lat: number; lng: number }
) {
  const body: Record<string, unknown> = { textQuery: query, maxResultCount: 1 };
  if (locationBias) {
    body.locationBias = {
      circle: { center: { latitude: locationBias.lat, longitude: locationBias.lng }, radius: 50000 },
    };
  }

  const res = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.places?.[0] ?? null;
}

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const cacheOnly = process.argv.includes("--cache-only");

  if (!apiKey && !cacheOnly) {
    throw new Error("GOOGLE_PLACES_API_KEY 未設定");
  }

  const itineraries = await prisma.itinerary.findMany({
    select: { id: true, title: true, days: true },
  });

  console.log(`找到 ${itineraries.length} 筆行程\n`);

  let totalEnriched = 0;
  let totalCached = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const itinerary of itineraries) {
    const days = (typeof itinerary.days === "string"
      ? JSON.parse(itinerary.days)
      : itinerary.days) as Record<string, unknown>[];

    let changed = false;
    let enriched = 0, cached = 0, skipped = 0, failed = 0;

    for (const day of days) {
      const stops = (day.stops ?? []) as Record<string, unknown>[];
      const cityHint =
        (typeof day.waypointCity === "string" ? day.waypointCity : "") ||
        (typeof day.transitTo === "string" ? day.transitTo : "") ||
        "";

      const meals = day.meals as Record<string, Record<string, unknown>> | undefined;
      if (meals) {
        for (const mealKey of ["breakfast", "lunch", "dinner"] as const) {
          const meal = meals[mealKey];
          if (!meal) continue;

          // Already enriched
          if (meal.placeId && meal.lat != null && meal.lng != null) {
            const query = cityHint ? `${meal.name} ${cityHint}` : String(meal.name);
            await prisma.place.upsert({
              where: { id: String(meal.placeId) },
              create: { id: String(meal.placeId), name: String(meal.name), address: meal.address as string ?? null, lat: meal.lat as number, lng: meal.lng as number, rating: meal.rating as number ?? null },
              update: { lat: meal.lat as number, lng: meal.lng as number },
            });
            await prisma.placeQuery.upsert({
              where: { query },
              create: { query, placeId: String(meal.placeId) },
              update: { placeId: String(meal.placeId) },
            });
            cached++;
            continue;
          }

          if (cacheOnly) {
            skipped++;
            continue;
          }

          const query = cityHint ? `${meal.name} ${cityHint}` : String(meal.name);

          const hit = await prisma.placeQuery.findUnique({
            where: { query },
            include: { place: true },
          });

          if (hit?.place.lat != null && hit.place.lng != null) {
            meals[mealKey] = {
              ...meal,
              placeId: hit.place.id,
              lat: hit.place.lat,
              lng: hit.place.lng,
              address: hit.place.address,
              rating: hit.place.rating,
            };
            changed = true;
            cached++;
            continue;
          }

          try {
            const cityCenter = await resolveCityCenter(cityHint, apiKey!);
            let place = await searchPlace(query, apiKey!, cityCenter ?? undefined);

            if (place && cityCenter) {
              const km = haversineKm(
                place.location.latitude, place.location.longitude,
                cityCenter.lat, cityCenter.lng
              );
              if (km > REJECT_KM_THRESHOLD) {
                console.log(`  ⚠️ 略過「${query}」：配對結果距離 ${cityHint} ${Math.round(km)} km，疑似錯誤匹配 (${place.formattedAddress})`);
                place = null;
              }
            }

            if (place) {
              meals[mealKey] = {
                ...meal,
                placeId: place.id,
                lat: place.location.latitude,
                lng: place.location.longitude,
                address: place.formattedAddress,
                rating: place.rating ?? null,
              };
              await prisma.place.upsert({
                where: { id: place.id },
                create: { id: place.id, name: place.displayName?.text ?? String(meal.name), address: place.formattedAddress, lat: place.location.latitude, lng: place.location.longitude, rating: place.rating ?? null },
                update: { name: place.displayName?.text ?? String(meal.name), address: place.formattedAddress, lat: place.location.latitude, lng: place.location.longitude, rating: place.rating ?? null },
              });
              await prisma.placeQuery.upsert({
                where: { query },
                create: { query, placeId: place.id },
                update: { placeId: place.id },
              });
              changed = true;
              enriched++;
            } else {
              failed++;
            }
          } catch {
            failed++;
          }

          await new Promise((r) => setTimeout(r, 150));
        }
      }

      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];

        // Already enriched
        if (stop.placeId && stop.lat != null && stop.lng != null) {
          // Still upsert to cache in case it's missing
          const query = cityHint ? `${stop.name} ${cityHint}` : String(stop.name);
          await prisma.place.upsert({
            where: { id: String(stop.placeId) },
            create: { id: String(stop.placeId), name: String(stop.name), address: stop.address as string ?? null, lat: stop.lat as number, lng: stop.lng as number, rating: stop.rating as number ?? null },
            update: { lat: stop.lat as number, lng: stop.lng as number },
          });
          await prisma.placeQuery.upsert({
            where: { query },
            create: { query, placeId: String(stop.placeId) },
            update: { placeId: String(stop.placeId) },
          });
          cached++;
          continue;
        }

        if (cacheOnly) {
          skipped++;
          continue;
        }

        // Transport legs like "搭乘新幹線前往大阪" or "前往舊金山" aren't real POIs
        const isTransportLeg =
          (stop.name as string).startsWith("搭") || (stop.name as string).startsWith("前往");
        if (isTransportLeg) {
          skipped++;
          continue;
        }

        const query = cityHint ? `${stop.name} ${cityHint}` : String(stop.name);

        // Check PlaceQuery cache first
        const hit = await prisma.placeQuery.findUnique({
          where: { query },
          include: { place: true },
        });

        if (hit?.place.lat != null && hit.place.lng != null) {
          stops[i] = {
            ...stop,
            placeId: hit.place.id,
            lat: hit.place.lat,
            lng: hit.place.lng,
            address: hit.place.address,
            rating: hit.place.rating,
          };
          changed = true;
          cached++;
          continue;
        }

        // Call Google API, biased toward the day's city so a same-named
        // place elsewhere (e.g. in Taiwan/HK) doesn't win the match
        try {
          const cityCenter = await resolveCityCenter(cityHint, apiKey!);
          let place = await searchPlace(query, apiKey!, cityCenter ?? undefined);

          if (place && cityCenter) {
            const km = haversineKm(
              place.location.latitude, place.location.longitude,
              cityCenter.lat, cityCenter.lng
            );
            if (km > REJECT_KM_THRESHOLD) {
              console.log(`  ⚠️ 略過「${query}」：配對結果距離 ${cityHint} ${Math.round(km)} km，疑似錯誤匹配 (${place.formattedAddress})`);
              place = null;
            }
          }

          if (place) {
            stops[i] = {
              ...stop,
              placeId: place.id,
              lat: place.location.latitude,
              lng: place.location.longitude,
              address: place.formattedAddress,
              rating: place.rating ?? null,
            };
            await prisma.place.upsert({
              where: { id: place.id },
              create: { id: place.id, name: place.displayName?.text ?? String(stop.name), address: place.formattedAddress, lat: place.location.latitude, lng: place.location.longitude, rating: place.rating ?? null },
              update: { name: place.displayName?.text ?? String(stop.name), address: place.formattedAddress, lat: place.location.latitude, lng: place.location.longitude, rating: place.rating ?? null },
            });
            await prisma.placeQuery.upsert({
              where: { query },
              create: { query, placeId: place.id },
              update: { placeId: place.id },
            });
            changed = true;
            enriched++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }

        // Avoid rate limit
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    if (changed) {
      await prisma.itinerary.update({
        where: { id: itinerary.id },
        data: { days: JSON.stringify(days) },
      });
    }

    const label = itinerary.title.slice(0, 45).padEnd(45);
    console.log(`  ${label} API:${enriched} 快取:${cached} 跳過:${skipped} 失敗:${failed}`);
    totalEnriched += enriched;
    totalCached += cached;
    totalSkipped += skipped;
    totalFailed += failed;
  }

  console.log(`\n完成  API:${totalEnriched}  快取:${totalCached}  跳過:${totalSkipped}  失敗:${totalFailed}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

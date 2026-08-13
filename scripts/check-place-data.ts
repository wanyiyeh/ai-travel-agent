/**
 * Sanity-check the Place/PlaceQuery cache. Flags: missing/invalid coordinates,
 * out-of-range rating, address that doesn't mention the city it was searched
 * under, same-day stops that are suspiciously far apart (possible wrong-place
 * match), and meals whose resolved place isn't actually a food establishment.
 *
 * Everything except the meal-type check is pure offline DB reads. The meal-type
 * check calls the Google Places Details API only for meals whose `types` isn't
 * cached yet in Place.types — once fetched, results are cached so repeat runs
 * stay offline for places already checked. Requires GOOGLE_PLACES_API_KEY;
 * silently skips (not fails) any meal it can't verify without one.
 *
 * Run: npx tsx scripts/check-place-data.ts
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

// >50km between same-day stops is almost certainly a wrong city/branch match
const SAME_DAY_KM_THRESHOLD = 50;

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

// Same-city places should cluster together; a member far from its group's
// centroid is likely a wrong-branch/wrong-city match (language-agnostic,
// unlike comparing the city name against the address string).
const CITY_CLUSTER_KM_THRESHOLD = 50;

// A meal matched to a place with none of these types is almost certainly the
// wrong business (e.g. a hair salon that happens to share a restaurant's name)
// — this catches same-city mismatches that distance-based checks can't, since
// the coordinates are often still perfectly plausible for the city.
const FOOD_TYPE_KEYWORDS = [
  "restaurant", "food", "cafe", "bakery", "bar", "diner", "buffet",
  "dessert", "coffee", "meal_", "deli", "izakaya", "pub", "brunch",
  "breakfast", "snack", "confectionery", "bistro", "tea_house", "market",
];

function isFoodPlace(types: string[]): boolean {
  return types.some((t) => FOOD_TYPE_KEYWORDS.some((kw) => t.includes(kw)));
}

async function fetchPlaceTypes(placeId: string, apiKey: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "types" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.types) ? data.types : null;
  } catch {
    return null;
  }
}

async function main() {
  const places = await prisma.place.findMany({ include: { queries: true } });
  const itineraries = await prisma.itinerary.findMany({
    select: { id: true, title: true, days: true },
  });

  console.log(`檢查 ${places.length} 筆 Place、${itineraries.length} 筆行程\n`);

  // --- Per-place checks (coordinates, rating) ---
  let errorCount = 0;
  let warnCount = 0;

  for (const place of places) {
    const problems: string[] = [];

    if (place.lat == null || place.lng == null) {
      problems.push("❌ 缺少座標");
    } else {
      if (place.lat === 0 && place.lng === 0) {
        problems.push("❌ 座標為 (0,0)，疑似未成功寫入");
      }
      if (place.lat < -90 || place.lat > 90 || place.lng < -180 || place.lng > 180) {
        problems.push(`❌ 座標超出合法範圍 (${place.lat}, ${place.lng})`);
      }
    }

    if (place.rating != null && (place.rating < 0 || place.rating > 5)) {
      problems.push(`⚠️ 評分超出範圍 (${place.rating})`);
    }

    if (!place.address) {
      problems.push("⚠️ 缺少地址");
    }

    if (problems.length > 0) {
      console.log(`${place.name} (${place.id})`);
      for (const p of problems) {
        console.log(`  ${p}`);
        if (p.startsWith("❌")) errorCount++;
        else warnCount++;
      }
    }
  }

  // --- City-cluster check: places searched under the same city hint should
  // be geographically close to each other. Flag outliers by distance from
  // the group's centroid instead of comparing text (address language varies). ---
  const cityGroups = new Map<string, { id: string; name: string; lat: number; lng: number }[]>();
  for (const place of places) {
    if (place.lat == null || place.lng == null) continue;
    const cityHints = new Set<string>();
    for (const q of place.queries) {
      const cityPart = q.query.replace(place.name, "").trim();
      if (cityPart) cityHints.add(cityPart);
    }
    for (const hint of cityHints) {
      if (!cityGroups.has(hint)) cityGroups.set(hint, []);
      cityGroups.get(hint)!.push({ id: place.id, name: place.name, lat: place.lat, lng: place.lng });
    }
  }

  const median = (nums: number[]) => {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  for (const [cityHint, members] of cityGroups) {
    if (members.length < 3) continue; // too few points to trust a centroid
    // Median (not mean) so a couple of extreme mismatches don't drag the
    // centroid toward themselves and mask/exaggerate other members.
    const centroidLat = median(members.map((m) => m.lat));
    const centroidLng = median(members.map((m) => m.lng));

    for (const m of members) {
      const km = haversineKm(m.lat, m.lng, centroidLat, centroidLng);
      if (km > CITY_CLUSTER_KM_THRESHOLD) {
        console.log(`${m.name} (${m.id})`);
        console.log(
          `  ⚠️ 距離「${cityHint}」其他景點的中心點 ${Math.round(km)} km，可能搜尋配對到錯誤城市/分店`
        );
        warnCount++;
      }
    }
  }

  // --- Cross-check against itinerary stops: same-day distance outliers ---
  for (const itinerary of itineraries) {
    const days = (typeof itinerary.days === "string"
      ? JSON.parse(itinerary.days)
      : itinerary.days) as Record<string, unknown>[];

    for (const day of days) {
      // On a transit day, stop 0 is the departure->arrival journey itself and
      // is expected to be far from what follows; stops from index 1 onward
      // are all required to be in the arrival city, so they're still checked
      // against each other like a normal day.
      const stops = ((day.stops ?? []) as Record<string, unknown>[])
        .slice(day.isTransitDay ? 1 : 0)
        .filter((s) => typeof s.lat === "number" && typeof s.lng === "number");

      for (let i = 0; i < stops.length; i++) {
        for (let j = i + 1; j < stops.length; j++) {
          const a = stops[i];
          const b = stops[j];
          const km = haversineKm(a.lat as number, a.lng as number, b.lat as number, b.lng as number);
          if (km > SAME_DAY_KM_THRESHOLD) {
            console.log(
              `${itinerary.title} 第 ${day.day} 天：「${a.name}」↔「${b.name}」相距 ${Math.round(km)} km`
            );
            console.log(`  ⚠️ 同天景點距離過遠，疑似地點配對錯誤`);
            warnCount++;
          }
        }
      }
    }
  }

  // --- Meal type check: flag meals whose place isn't actually food-related ---
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  let mealsChecked = 0, mealsFetched = 0, mealsSkippedNoKey = 0;

  for (const itinerary of itineraries) {
    const days = (typeof itinerary.days === "string"
      ? JSON.parse(itinerary.days)
      : itinerary.days) as Record<string, unknown>[];

    for (const day of days) {
      const meals = day.meals as Record<string, Record<string, unknown>> | undefined;
      if (!meals) continue;

      for (const mealType of ["breakfast", "lunch", "dinner", "snack"]) {
        const meal = meals[mealType];
        const placeId = meal?.placeId as string | undefined;
        if (!meal || !placeId) continue;

        const cached = await prisma.place.findUnique({ where: { id: placeId } });
        let types: string[] | null = cached?.types ? JSON.parse(cached.types) : null;

        if (types == null) {
          if (!apiKey) { mealsSkippedNoKey++; continue; }
          types = await fetchPlaceTypes(placeId, apiKey);
          mealsFetched++;
          if (types) {
            await prisma.place.upsert({
              where: { id: placeId },
              create: {
                id: placeId,
                name: (meal.name as string) ?? "",
                address: (meal.address as string) ?? null,
                lat: typeof meal.lat === "number" ? meal.lat : null,
                lng: typeof meal.lng === "number" ? meal.lng : null,
                rating: typeof meal.rating === "number" ? meal.rating : null,
                types: JSON.stringify(types),
              },
              update: { types: JSON.stringify(types) },
            });
          }
          await new Promise((r) => setTimeout(r, 120));
        }

        mealsChecked++;
        if (types && !isFoodPlace(types)) {
          console.log(`${itinerary.title} 第 ${day.day} 天 ${mealType}：「${meal.name}」`);
          console.log(`  ❌ 配對地點類型為 [${types.join("、")}]，不是餐飲類場所，可能配對到同名的其他商家`);
          errorCount++;
        }
      }
    }
  }

  console.log(
    `\n餐廳類型檢查：檢查 ${mealsChecked} 筆（新查詢 ${mealsFetched} 筆）` +
    (mealsSkippedNoKey > 0 ? `，${mealsSkippedNoKey} 筆因缺少 GOOGLE_PLACES_API_KEY 跳過` : "")
  );

  console.log(`\n完成：❌ ${errorCount} 個錯誤，⚠️ ${warnCount} 個警告需人工複查`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

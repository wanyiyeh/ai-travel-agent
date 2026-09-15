/**
 * One-time backfill of `Place.types` for places already referenced by
 * comparable itinerary days (see scripts/shadow-compare-scheduler.ts) —
 * scoped to already-cached Place rows that were already paid for via Text
 * Search, not the whole candidate pool. This is the cost-bounded option (a)
 * from plan/hybrid-rule-engine-scheduling.md section 7's opening-hours/type
 * risk note: only fetch extra fields for stops already selected into a real
 * itinerary, never the full 15-20-per-city hint pool.
 *
 * Calls Google Place Details (fields=types only) once per place missing
 * `types`, 120ms apart. Requires GOOGLE_PLACES_API_KEY; exits early if unset.
 *
 * Run: npx tsx scripts/backfill-place-types.ts
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

type LlmStop = { placeId?: string; lat?: number; lng?: number };
type LlmDay = { isTransitDay?: boolean; stops?: LlmStop[] };

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
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.log("缺少 GOOGLE_PLACES_API_KEY，無法補查 types，結束。");
    return;
  }

  const itineraries = await prisma.itinerary.findMany({ select: { days: true } });
  const placeIds = new Set<string>();
  for (const it of itineraries) {
    const days = JSON.parse(it.days as unknown as string) as LlmDay[];
    for (const day of days) {
      const stops = day.stops ?? [];
      if (day.isTransitDay || stops.length < 2) continue;
      if (!stops.every((s) => typeof s.lat === "number" && typeof s.lng === "number")) continue;
      for (const s of stops) if (s.placeId) placeIds.add(s.placeId);
    }
  }

  const places = await prisma.place.findMany({
    where: { id: { in: [...placeIds] }, types: null },
    select: { id: true, name: true },
  });

  console.log(`${placeIds.size} 個候選地點，其中 ${places.length} 筆缺少 types，開始補查...`);

  let fetched = 0, failed = 0;
  for (const place of places) {
    const types = await fetchPlaceTypes(place.id, apiKey);
    if (types) {
      await prisma.place.update({ where: { id: place.id }, data: { types: JSON.stringify(types) } });
      fetched++;
    } else {
      failed++;
      console.log(`  ⚠️ 查無 types：${place.name} (${place.id})`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log(`\n完成：補齊 ${fetched} 筆，失敗/查無 ${failed} 筆。`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

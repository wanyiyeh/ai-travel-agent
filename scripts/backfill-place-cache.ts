/**
 * Backfill Place + PlaceQuery cache from existing itinerary JSON blobs.
 * No Google API calls — reads placeId/lat/lng already stored in stops.
 *
 * Run: npx tsx scripts/backfill-place-cache.ts
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

async function main() {
  const itineraries = await prisma.itinerary.findMany({
    select: { id: true, title: true, days: true },
  });

  console.log(`找到 ${itineraries.length} 筆行程，開始回填...\n`);

  let totalUpserted = 0;
  let totalSkipped = 0;

  for (const itinerary of itineraries) {
    const days = (typeof itinerary.days === "string"
      ? JSON.parse(itinerary.days)
      : itinerary.days) as Record<string, unknown>[];

    let count = 0;

    for (const day of days) {
      const stops = (day.stops ?? []) as Record<string, unknown>[];
      const cityHint =
        (typeof day.waypointCity === "string" ? day.waypointCity : "") ||
        (typeof day.transitTo === "string" ? day.transitTo : "") ||
        "";

      for (const stop of stops) {
        const { placeId, name, address, lat, lng, rating } = stop as {
          placeId?: string;
          name?: string;
          address?: string;
          lat?: number;
          lng?: number;
          rating?: number | null;
        };

        if (!placeId || lat == null || lng == null) {
          totalSkipped++;
          continue;
        }

        const placeName = typeof name === "string" ? name : placeId;
        const query = cityHint ? `${placeName} ${cityHint}` : placeName;

        await prisma.place.upsert({
          where: { id: placeId },
          create: {
            id: placeId,
            name: placeName,
            address: typeof address === "string" ? address : null,
            lat,
            lng,
            rating: rating ?? null,
          },
          update: {
            name: placeName,
            address: typeof address === "string" ? address : null,
            lat,
            lng,
            rating: rating ?? null,
          },
        });

        await prisma.placeQuery.upsert({
          where: { query },
          create: { query, placeId },
          update: { placeId },
        });

        count++;
        totalUpserted++;
      }
    }

    console.log(`  ✅ ${itinerary.title.slice(0, 50).padEnd(50)} → ${count} 筆`);
  }

  console.log(`\n回填完成：${totalUpserted} 筆寫入，${totalSkipped} 筆無座標跳過`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

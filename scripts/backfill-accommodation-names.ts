/**
 * One-off fix for accommodations that were enriched before the bug fix in
 * accommodation/enrich/route.ts: the enrich call found a real hotel via
 * Google Places (placeId/lat/lng/address/rating all set) but never saved
 * the hotel's actual name, so the UI fell back to showing the area name
 * (e.g. "名古屋市中心") as if it were the hotel.
 *
 * The real name is still sitting in the Place cache (upsertPlace was called
 * with it at the time), so this just copies it back onto the accommodation.
 *
 * Run: npx tsx scripts/backfill-accommodation-names.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const itineraries = await prisma.itinerary.findMany({
    select: { id: true, title: true, days: true },
  });

  let fixedCount = 0;
  let missingCount = 0;

  for (const itinerary of itineraries) {
    const days = (typeof itinerary.days === "string"
      ? JSON.parse(itinerary.days)
      : itinerary.days) as Record<string, unknown>[];

    let changed = false;

    for (const day of days) {
      const accommodation = day.accommodation as Record<string, unknown> | undefined;
      if (!accommodation) continue;
      if (accommodation.name || !accommodation.placeId) continue;

      const place = await prisma.place.findUnique({
        where: { id: accommodation.placeId as string },
      });

      if (place) {
        accommodation.name = place.name;
        changed = true;
        fixedCount++;
      } else {
        missingCount++;
        console.warn(`  找不到快取：${itinerary.title} / placeId=${accommodation.placeId}`);
      }
    }

    if (changed) {
      await prisma.itinerary.update({
        where: { id: itinerary.id },
        data: { days: JSON.stringify(days) },
      });
      console.log(`  已修正：${itinerary.title}`);
    }
  }

  console.log(`\n完成：補上 ${fixedCount} 筆住宿名稱，${missingCount} 筆快取中找不到對應資料。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

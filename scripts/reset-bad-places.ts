/**
 * One-off fix for stops that got mismatched to a same-named place elsewhere
 * (e.g. "金門大橋 洛杉磯" resolving to Kinmen, Taiwan instead of the Golden
 * Gate Bridge). Found via `npm run check-places`.
 *
 * Clears the cached placeId/lat/lng/address on the affected stops so the
 * next `npm run enrich-all` re-queries them (now with location bias), and
 * removes the bad rows from the Place/PlaceQuery cache.
 *
 * Run: npx tsx scripts/reset-bad-places.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Confirmed wrong-place matches (place name collided with a homonym in
// Taiwan/Hong Kong because the Places API call had no location bias).
const BAD_PLACE_IDS = [
  "ChIJ00x_Su2iFDQRlSdtL78VFJU", // 金門大橋 -> matched Kinmen, Taiwan
  "ChIJwegSzMkABDQR4AcCYFhdzL4", // 聯合廣場 -> matched Hong Kong
  "ChIJ117YdiWrQjQR6zxN285kGEk", // 法爾茲酒莊 -> matched Taipei
  "ChIJi7MojDwjbjQRLVnAvYBThK4", // 比斯開灣 -> matched Pingtung, Taiwan
  "ChIJ403sKvr0ZzQRvzdsgjbLjCs", // 高地小鎮 -> matched Yilan, Taiwan
  "ChIJncxhFbodaDQRUW73A9d1qy0", // 高地文化村 -> matched Taoyuan, Taiwan
  "ChIJ6QpxzaZBDEcR26HsPg_tnKE", // 前往聖巴巴拉 -> matched St Barbara's Church, Czechia
  "ChIJ4SEGMiQABDQRRhn7SYWq0fM", // 海洋公園 -> matched Ocean Park, Hong Kong
  "ChIJUX-lgjWpQjQRO1OC4UqI2iQ", // 運河旁的咖啡館 -> matched a café in Taipei
  "ChIJN1y6RacCaDQRElenCbyeN2w", // 墨爾本咖啡文化體驗 -> matched a café in Taipei
  "ChIJKwvcpToK3okRECXf-FfVrnI", // 國會大廈 -> matched NY State Capitol, Albany (should be US Capitol, DC)
  "ChIJ-545aQ2kQjQRPvCkWdkJTmA", // 海濱步道 -> matched a promenade in Bali District, New Taipei (should be Miami)
  "ChIJccGhXRqrQjQRlsWMQ6UCGXo", // 名古屋美食街 -> matched an alley in Songshan District, Taipei
  "ChIJE6BzZAB3A2ARpRGc6nfLZa0", // Katsu Sand (breakfast) -> matched a hair salon named "sand" in Nagoya (same city, wrong business type — not a cross-country homonym)
  "ChIJ6QlgZIhzA2ARuiG7jOZhL0g", // Kisoji (dinner) -> matched a sublocality/political area named "Kisoji" in Nagoya, not the restaurant chain
  "ChIJawhFpEJ1A2ARBDU1Jbe4wZ0", // 道頓堀 -> matched "Dohtonbori" in Kiyosu, Aichi (near Nagoya) instead of the real Osaka Dotonbori; caused by a transit-day stop being geocoded against the departure city hint instead of the arrival city (fixed in enrich/route.ts and enrich-all-stops/route.ts)
];

async function main() {
  const badIds = new Set(BAD_PLACE_IDS);
  const itineraries = await prisma.itinerary.findMany({
    select: { id: true, title: true, days: true },
  });

  let clearedStops = 0;

  for (const itinerary of itineraries) {
    const days = (typeof itinerary.days === "string"
      ? JSON.parse(itinerary.days)
      : itinerary.days) as Record<string, unknown>[];

    let changed = false;

    for (const day of days) {
      const stops = (day.stops ?? []) as Record<string, unknown>[];
      for (const stop of stops) {
        if (typeof stop.placeId === "string" && badIds.has(stop.placeId)) {
          delete stop.placeId;
          delete stop.lat;
          delete stop.lng;
          delete stop.address;
          delete stop.rating;
          changed = true;
          clearedStops++;
        }
      }
    }

    if (changed) {
      await prisma.itinerary.update({
        where: { id: itinerary.id },
        data: { days: JSON.stringify(days) },
      });
      console.log(`  已清除：${itinerary.title}`);
    }
  }

  // PlaceQuery has an FK to Place, so delete the query rows first.
  const deletedQueries = await prisma.placeQuery.deleteMany({
    where: { placeId: { in: [...badIds] } },
  });
  const deletedPlaces = await prisma.place.deleteMany({
    where: { id: { in: [...badIds] } },
  });

  console.log(
    `\n完成：清除 ${clearedStops} 個 stop 的快取欄位，刪除 ${deletedQueries.count} 筆 PlaceQuery、${deletedPlaces.count} 筆 Place`
  );
  console.log("接著執行 `npm run enrich-all` 以重新查詢正確地點。");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

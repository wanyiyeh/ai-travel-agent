/**
 * Deletes Google coordinates older than 30 days from itineraries, the trash,
 * candidate history and the Place table (ADR-0006, src/lib/coordsPurge.ts).
 * Places keep their IDs; coordinates come back when a day is next shown.
 *
 * Run daily once deployed (#211); until then by hand. Needs
 * COMPLIANT_PLACE_STORAGE=1, or it does nothing:
 *   COMPLIANT_PLACE_STORAGE=1 npm run purge-expired-coords                                  # dev.db (DATABASE_URL in .env)
 *   COMPLIANT_PLACE_STORAGE=1 DATABASE_URL="file:./mock.db" npm run purge-expired-coords    # mock.db
 * Makes no Google/OpenAI calls.
 */

import { PrismaClient } from "@prisma/client";
import { existsSync } from "fs";
import { purgeExpiredCoords } from "@/lib/coordsPurge";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await purgeExpiredCoords(prisma);
    if (!result) {
      console.log("COMPLIANT_PLACE_STORAGE is not 1: fetch times aren't recorded, so nothing was purged.");
      return;
    }
    console.log(
      `Purged expired coordinates from ${result.itineraries} itinerary(ies), ${result.deletedStops} trashed stop(s), ` +
        `${result.deletedDays} trashed day(s), ${result.candidateLogs} candidate log(s) and ${result.places} place(s) ` +
        `(${process.env.DATABASE_URL}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

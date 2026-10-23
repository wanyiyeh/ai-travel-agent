/**
 * Deletes Google coordinates older than 30 days from itineraries, the trash,
 * candidate history and the Place table (ADR-0006, src/lib/coordsPurge.ts).
 * Places keep their IDs; coordinates come back when a day is next shown.
 *
 * Run daily once deployed (#211); until then by hand:
 *   npm run purge-expired-coords                                  # dev.db (DATABASE_URL in .env)
 *   DATABASE_URL="file:./mock.db" npm run purge-expired-coords    # mock.db
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

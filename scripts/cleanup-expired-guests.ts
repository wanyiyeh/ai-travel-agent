/**
 * Runs the expired-guest part of the daily cleanup by hand
 * (src/lib/housekeeping.ts): expired guest itineraries and guests, old usage
 * events, and stale rate-limit windows, daily call counts and generation
 * leases. Once deployed, Vercel Cron runs it daily with the coordinate purge
 * (src/app/api/cron/daily/route.ts).
 *
 *   npm run cleanup-expired-guests                                  # dev database (DATABASE_URL in .env)
 *   DATABASE_URL="postgresql://travel:travel@localhost:5432/travel_mock" npm run cleanup-expired-guests    # travel_mock
 * Makes no Google/OpenAI calls.
 */

import { PrismaClient } from "@prisma/client";
import { existsSync } from "fs";
import { cleanupExpiredGuests } from "@/lib/housekeeping";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await cleanupExpiredGuests(prisma);
    console.log(`Deleted: ${JSON.stringify(result)} (${process.env.DATABASE_URL?.replace(/\/\/[^@]*@/, "//***@")})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Deletes guest itineraries past their expiresAt, then guest users left with
 * no itineraries once their cookie would have expired too
 * (plan/access-control.md §7), and usage-quota events older than 30 days
 * (only the last 24h are ever counted; §4 keeps 30 for review). Cascades remove the itineraries' trash and
 * candidate logs. Also drops rate-limit windows, daily call counts and
 * generation leases nobody needs any more (#209). Expired itineraries already read as not found, so this is
 * housekeeping, not access control.
 *
 * Run daily once deployed; until then by hand:
 *   npm run cleanup-expired-guests                                  # dev database (DATABASE_URL in .env)
 *   DATABASE_URL="postgresql://travel:travel@localhost:5432/travel_mock" npm run cleanup-expired-guests    # travel_mock
 * Makes no Google/OpenAI calls.
 */

import { PrismaClient } from "@prisma/client";
import { existsSync } from "fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const GUEST_TTL_MS = 3 * 24 * 60 * 60 * 1000; // matches src/lib/auth/guest.ts
const USAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// The longest rate-limit window is a day (RATE_LIMITS in src/lib/rateLimit.ts);
// a window older than two of those can no longer affect a decision.
const RATE_LIMIT_WINDOW_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

async function main() {
  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const itineraries = await prisma.itinerary.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    // A guest whose cookie is still valid may be about to generate again, so
    // only drop guests older than the cookie's lifetime.
    const guests = await prisma.user.deleteMany({
      where: {
        isGuest: true,
        createdAt: { lt: new Date(now.getTime() - GUEST_TTL_MS) },
        itineraries: { none: {} },
      },
    });
    const usage = await prisma.usageEvent.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - USAGE_RETENTION_MS) } },
    });
    const windows = await prisma.rateLimitWindow.deleteMany({
      where: { windowStart: { lt: new Date(now.getTime() - RATE_LIMIT_WINDOW_RETENTION_MS) } },
    });
    const callCounts = await prisma.dailyCallCount.deleteMany({
      where: { day: { lt: new Date(now.getTime() - USAGE_RETENTION_MS).toISOString().slice(0, 10) } },
    });
    const leases = await prisma.generationLock.deleteMany({ where: { expiresAt: { lt: now } } });
    console.log(
      `Deleted ${itineraries.count} expired guest itinerary(ies), ${guests.count} guest user(s), ${usage.count} old usage event(s), ` +
        `${windows.count} rate-limit window(s), ${callCounts.count} daily call count(s) and ${leases.count} expired lease(s).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

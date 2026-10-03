/**
 * Deletes guest itineraries past their expiresAt, then guest users left with
 * no itineraries once their cookie would have expired too
 * (plan/access-control.md §7), and usage-quota events older than 30 days
 * (only the last 24h are ever counted; §4 keeps 30 for review). Cascades remove the itineraries' trash and
 * candidate logs. Expired itineraries already read as not found, so this is
 * housekeeping, not access control.
 *
 * Run daily once deployed; until then by hand:
 *   npm run cleanup-expired-guests                                  # dev.db (DATABASE_URL in .env)
 *   DATABASE_URL="file:./mock.db" npm run cleanup-expired-guests    # mock.db
 * Makes no Google/OpenAI calls.
 */

import { PrismaClient } from "@prisma/client";
import { existsSync } from "fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const GUEST_TTL_MS = 3 * 24 * 60 * 60 * 1000; // matches src/lib/auth/guest.ts
const USAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
    console.log(
      `Deleted ${itineraries.count} expired guest itinerary(ies), ${guests.count} guest user(s) and ${usage.count} old usage event(s) (${process.env.DATABASE_URL}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

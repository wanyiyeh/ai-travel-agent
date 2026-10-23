import type { PrismaClient } from "@prisma/client";
import { GUEST_TTL_MS } from "@/lib/auth/guest";
import { purgeExpiredCoords, type PurgeResult } from "@/lib/coordsPurge";

/**
 * The daily cleanup, run by Vercel Cron (src/app/api/cron/daily/route.ts)
 * and by hand with npm run cleanup-expired-guests. Takes a plain
 * PrismaClient so both can run it; makes no Google/OpenAI calls.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
// Only the last 24h of usage are ever counted; 30 days are kept for review
// (plan/access-control.md §4). Daily call counts are kept as long.
const USAGE_RETENTION_MS = 30 * DAY_MS;
// The longest rate-limit window is a day (RATE_LIMITS in rateLimit.ts); a
// window older than two of those can no longer affect a decision.
const RATE_LIMIT_WINDOW_RETENTION_MS = 2 * DAY_MS;

export interface ExpiredGuestCleanup {
  itineraries: number;
  guests: number;
  usageEvents: number;
  rateLimitWindows: number;
  dailyCallCounts: number;
  generationLeases: number;
}

/**
 * Deletes guest itineraries past their expiresAt, then guest users left with
 * no itineraries once their cookie would have expired too
 * (plan/access-control.md §7), old usage events, and rate-limit windows,
 * daily call counts and generation leases nobody needs any more (#209).
 * Cascades remove the itineraries' trash and candidate logs. Expired
 * itineraries already read as not found, so this is housekeeping, not
 * access control.
 */
export async function cleanupExpiredGuests(prisma: PrismaClient, now = new Date()): Promise<ExpiredGuestCleanup> {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const itineraries = await prisma.itinerary.deleteMany({ where: { expiresAt: { lt: now } } });
  // A guest whose cookie is still valid may be about to generate again, so
  // only drop guests older than the cookie's lifetime.
  const guests = await prisma.user.deleteMany({
    where: { isGuest: true, createdAt: { lt: ago(GUEST_TTL_MS) }, itineraries: { none: {} } },
  });
  const usageEvents = await prisma.usageEvent.deleteMany({ where: { createdAt: { lt: ago(USAGE_RETENTION_MS) } } });
  const rateLimitWindows = await prisma.rateLimitWindow.deleteMany({
    where: { windowStart: { lt: ago(RATE_LIMIT_WINDOW_RETENTION_MS) } },
  });
  const dailyCallCounts = await prisma.dailyCallCount.deleteMany({
    where: { day: { lt: ago(USAGE_RETENTION_MS).toISOString().slice(0, 10) } },
  });
  const generationLeases = await prisma.generationLock.deleteMany({ where: { expiresAt: { lt: now } } });
  return {
    itineraries: itineraries.count,
    guests: guests.count,
    usageEvents: usageEvents.count,
    rateLimitWindows: rateLimitWindows.count,
    dailyCallCounts: dailyCallCounts.count,
    generationLeases: generationLeases.count,
  };
}

export interface DailyHousekeeping {
  expiredGuests: ExpiredGuestCleanup;
  /** Google coordinates past 30 days (ADR-0006). */
  expiredCoords: PurgeResult;
}

export async function runDailyHousekeeping(prisma: PrismaClient, now = new Date()): Promise<DailyHousekeeping> {
  return {
    expiredGuests: await cleanupExpiredGuests(prisma, now),
    expiredCoords: await purgeExpiredCoords(prisma, now),
  };
}

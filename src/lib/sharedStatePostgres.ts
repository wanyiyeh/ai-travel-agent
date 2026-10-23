import { prisma } from "@/lib/db";
import { DAILY_CALL_BUDGET, utcDay, warnBudgetExhausted, type BudgetedService, type DailyBudgetStore } from "@/lib/dailyBudget";
import { GENERATION_LEASE_MS, decideWindow, type ConcurrencyGate, type RateLimitStore } from "@/lib/rateLimit";

/**
 * The rate limit, daily call budget and generation lock, kept in Postgres so
 * every serverless instance sees the same counts (#209, ADR-0003). Each
 * operation is atomic in the database, so two instances racing on the same
 * key can't both get through.
 */

/**
 * Sliding-window rate limit (decideWindow in rateLimit.ts). A transaction
 * holds an advisory lock on the key while it reads both windows and counts
 * the request, and drops the key's windows older than the previous one.
 */
export function createPostgresRateLimitStore(): RateLimitStore {
  return {
    async hit(key, rule, now = Date.now()) {
      const windowStart = new Date(Math.floor(now / rule.windowMs) * rule.windowMs);
      const prevStart = new Date(windowStart.getTime() - rule.windowMs);
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS locked`;
        const windows = await tx.rateLimitWindow.findMany({ where: { key, windowStart: { gte: prevStart } } });
        const count = windows.find((w) => w.windowStart.getTime() === windowStart.getTime())?.count ?? 0;
        const prevCount = windows.find((w) => w.windowStart.getTime() === prevStart.getTime())?.count ?? 0;
        const result = decideWindow(count, prevCount, rule, now);
        if (result.allowed) {
          await tx.rateLimitWindow.upsert({
            where: { key_windowStart: { key, windowStart } },
            create: { key, windowStart, count: 1 },
            update: { count: { increment: 1 } },
          });
        }
        await tx.rateLimitWindow.deleteMany({ where: { key, windowStart: { lt: prevStart } } });
        return result;
      });
    },
  };
}

/** Today's count per service, incremented only while it's under the limit, in one statement. */
export function createPostgresDailyBudget(limits: Record<BudgetedService, number> = DAILY_CALL_BUDGET): DailyBudgetStore {
  return {
    async consume(service, now = Date.now()) {
      const day = utcDay(now);
      const limit = limits[service];
      if (limit < 1) {
        warnBudgetExhausted(service, limit);
        return false;
      }
      const rows = await prisma.$queryRaw<{ count: number }[]>`
        INSERT INTO "DailyCallCount" (service, day, count) VALUES (${service}, ${day}, 1)
        ON CONFLICT (service, day) DO UPDATE SET count = "DailyCallCount".count + 1
        WHERE "DailyCallCount".count < ${limit}
        RETURNING count`;
      if (rows.length === 0) {
        warnBudgetExhausted(service, limit);
        return false;
      }
      return true;
    },
  };
}

/** One lease per key; an expired lease is taken over in the same statement that checks it. */
export function createPostgresGate(leaseMs = GENERATION_LEASE_MS): ConcurrencyGate {
  return {
    async tryAcquire(key, now = Date.now()) {
      const lease = crypto.randomUUID();
      const rows = await prisma.$queryRaw<{ lease: string }[]>`
        INSERT INTO "GenerationLock" (key, lease, expires_at) VALUES (${key}, ${lease}, ${new Date(now + leaseMs)})
        ON CONFLICT (key) DO UPDATE SET lease = EXCLUDED.lease, expires_at = EXCLUDED.expires_at
        WHERE "GenerationLock".expires_at <= ${new Date(now)}
        RETURNING lease`;
      return rows.length > 0 ? lease : null;
    },
    async release(key, lease) {
      await prisma.generationLock.deleteMany({ where: { key, lease } });
    },
  };
}

import { describe, expect, it } from "vitest";
import { createPostgresDailyBudget, createPostgresGate, createPostgresRateLimitStore } from "@/lib/sharedStatePostgres";
import { describeConcurrencyGate, describeDailyBudget, describeRateLimitStore } from "@tests/contracts/sharedState";

// The same contract as the in-memory stores (rateLimit.test.ts,
// dailyBudget.test.ts), against Postgres.
describeRateLimitStore("postgres", () => createPostgresRateLimitStore());
describeConcurrencyGate("postgres", (leaseMs) => createPostgresGate(leaseMs));
describeDailyBudget("postgres", (limits) => createPostgresDailyBudget(limits));

// Story: on Vercel two requests from one client can land on two server
// instances at the same moment. Each instance has its own store object;
// only the database is shared, and it must count them together (#209).
describe("two server instances sharing Postgres", () => {
  const key = () => `instances-${crypto.randomUUID()}`;

  it("count one client's requests together against the rate limit", async () => {
    const [a, b] = [createPostgresRateLimitStore(), createPostgresRateLimitStore()];
    const rule = { limit: 4, windowMs: 60_000 };
    const k = key();
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).hit(k, rule, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(4);
  });

  it("let only one of two simultaneous generations through", async () => {
    const [a, b] = [createPostgresGate(), createPostgresGate()];
    const k = key();
    const leases = await Promise.all([a.tryAcquire(k), b.tryAcquire(k)]);
    expect(leases.filter(Boolean)).toHaveLength(1);
  });

  it("share one daily budget", async () => {
    const limits = { google: 6, openai: 6 };
    const [a, b] = [createPostgresDailyBudget(limits), createPostgresDailyBudget(limits)];
    const day = Date.UTC(1999, 0, 1 + Math.floor(Math.random() * 300), 12);
    const results = await Promise.all(Array.from({ length: 14 }, (_, i) => (i % 2 ? a : b).consume("openai", day)));
    expect(results.filter(Boolean)).toHaveLength(6);
  });
});

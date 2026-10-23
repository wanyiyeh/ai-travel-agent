import { describe, expect, it } from "vitest";
import type { BudgetedService, DailyBudgetStore } from "@/lib/dailyBudget";
import type { ConcurrencyGate, RateLimitStore } from "@/lib/rateLimit";

// What every rate limit store, generation gate and daily budget must do,
// run against the in-memory ones (unit tests) and the Postgres ones
// (integration tests), so both behave the same (#209). Each test uses its
// own keys, since a database keeps them between tests.

const freshKey = () => `test-${crypto.randomUUID()}`;

export function describeRateLimitStore(name: string, makeStore: () => RateLimitStore) {
  describe(`${name}: sliding-window rate limit`, () => {
    const rule = { limit: 3, windowMs: 60_000 };
    const t0 = 1_000_000 * 60_000; // aligned to a window start

    it("allows up to the limit, then blocks with a Retry-After", async () => {
      const store = makeStore();
      const k = freshKey();
      expect((await store.hit(k, rule, t0)).allowed).toBe(true);
      expect((await store.hit(k, rule, t0 + 1)).allowed).toBe(true);
      expect((await store.hit(k, rule, t0 + 2)).remaining).toBe(0);
      const blocked = await store.hit(k, rule, t0 + 3);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    });

    it("keeps keys independent", async () => {
      const store = makeStore();
      const [a, b] = [freshKey(), freshKey()];
      for (let i = 0; i < 3; i++) await store.hit(a, rule, t0);
      expect((await store.hit(a, rule, t0)).allowed).toBe(false);
      expect((await store.hit(b, rule, t0)).allowed).toBe(true);
    });

    it("doesn't reset the moment a new window starts (no boundary burst)", async () => {
      const store = makeStore();
      const k = freshKey();
      for (let i = 0; i < 3; i++) await store.hit(k, rule, t0 + 59_000);
      // 1s into the next window the previous window still weighs ~98%.
      expect((await store.hit(k, rule, t0 + 61_000)).allowed).toBe(false);
    });

    it("admits again once the previous window has decayed enough", async () => {
      const store = makeStore();
      const k = freshKey();
      for (let i = 0; i < 3; i++) await store.hit(k, rule, t0);
      const blocked = await store.hit(k, rule, t0 + 60_000);
      expect(blocked.allowed).toBe(false);
      const retryAt = t0 + 60_000 + blocked.retryAfterSeconds * 1000;
      expect((await store.hit(k, rule, retryAt)).allowed).toBe(true);
    });

    it("forgets everything after two quiet windows", async () => {
      const store = makeStore();
      const k = freshKey();
      for (let i = 0; i < 3; i++) await store.hit(k, rule, t0);
      expect((await store.hit(k, rule, t0 + 120_000)).allowed).toBe(true);
    });

    it("doesn't count blocked requests", async () => {
      const store = makeStore();
      const k = freshKey();
      for (let i = 0; i < 10; i++) await store.hit(k, rule, t0);
      // Only the 3 admitted hits carry over, so after ~1/3 of the next window
      // the estimate (3 * 2/3 = 2) leaves room again.
      expect((await store.hit(k, rule, t0 + 60_000 + 21_000)).allowed).toBe(true);
    });

    it("lets exactly the limit through when requests arrive at once", async () => {
      const store = makeStore();
      const k = freshKey();
      const results = await Promise.all(Array.from({ length: 8 }, () => store.hit(k, rule, t0)));
      expect(results.filter((r) => r.allowed)).toHaveLength(3);
    });
  });
}

export function describeConcurrencyGate(name: string, makeGate: (leaseMs: number) => ConcurrencyGate) {
  describe(`${name}: generation gate`, () => {
    const leaseMs = 60_000;
    const t0 = Date.now();

    it("admits one per key until released", async () => {
      const gate = makeGate(leaseMs);
      const [ip, other] = [freshKey(), freshKey()];
      const lease = await gate.tryAcquire(ip, t0);
      expect(lease).toBeTruthy();
      expect(await gate.tryAcquire(ip, t0)).toBeNull();
      expect(await gate.tryAcquire(other, t0)).toBeTruthy();
      await gate.release(ip, lease!);
      expect(await gate.tryAcquire(ip, t0)).toBeTruthy();
    });

    it("lets one of several simultaneous requests in", async () => {
      const gate = makeGate(leaseMs);
      const ip = freshKey();
      const leases = await Promise.all(Array.from({ length: 5 }, () => gate.tryAcquire(ip, t0)));
      expect(leases.filter(Boolean)).toHaveLength(1);
    });

    it("frees a lease nobody released once it expires, and the late release can't free the new one", async () => {
      const gate = makeGate(leaseMs);
      const ip = freshKey();
      const stale = await gate.tryAcquire(ip, t0);
      expect(await gate.tryAcquire(ip, t0 + leaseMs - 1)).toBeNull();
      const fresh = await gate.tryAcquire(ip, t0 + leaseMs);
      expect(fresh).toBeTruthy();
      await gate.release(ip, stale!);
      expect(await gate.tryAcquire(ip, t0 + leaseMs + 1)).toBeNull();
    });
  });
}

export function describeDailyBudget(name: string, makeBudget: (limits: Record<BudgetedService, number>) => DailyBudgetStore) {
  describe(`${name}: daily call budget`, () => {
    // A day no other test touches, so a shared database starts it at 0.
    const day = Date.UTC(2001, 0, 1 + Math.floor(Math.random() * 3000), 12);
    const nextDay = day + 24 * 60 * 60 * 1000;

    it("refuses once the day's budget is used, per service, and starts over the next UTC day", async () => {
      const budget = makeBudget({ google: 5, openai: 2 });
      for (let i = 0; i < 2; i++) expect(await budget.consume("openai", day)).toBe(true);
      expect(await budget.consume("openai", day)).toBe(false);
      expect(await budget.consume("google", day)).toBe(true);
      expect(await budget.consume("openai", nextDay)).toBe(true);
    });

    it("lets exactly the budget through when calls arrive at once", async () => {
      const budget = makeBudget({ google: 5, openai: 5 });
      const later = nextDay + 24 * 60 * 60 * 1000;
      const results = await Promise.all(Array.from({ length: 12 }, () => budget.consume("google", later)));
      expect(results.filter(Boolean)).toHaveLength(5);
    });
  });
}

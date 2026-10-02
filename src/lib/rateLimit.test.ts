import { describe, expect, it } from "vitest";
import { classifyApiPath, clientIp, createConcurrencyGate, createMemoryStore } from "./rateLimit";

describe("classifyApiPath", () => {
  it.each([
    ["/api/v1/generate-stream", "POST", "generate"],
    ["/api/v1/days/d1/accommodation/regenerate", "POST", "ai"],
    ["/api/v1/days/d1/meals/lunch/regenerate", "POST", "ai"],
    ["/api/v1/days/d1/stop-suggestions", "POST", "ai"],
    ["/api/v1/days/d1/stops", "POST", "ai"],
    ["/api/v1/itinerary/i1/restructure", "POST", "ai"],
    ["/api/v1/itinerary/i1/transit-recommendations", "POST", "ai"],
    ["/api/v1/days/d1/accommodation/enrich", "POST", "google"],
    ["/api/v1/days/d1/recalculate-transport", "POST", "google"],
    ["/api/v1/itinerary/i1/enrich-all-stops", "POST", "google"],
    ["/api/v1/places/search", "POST", "google"],
    ["/api/v1/places/city-centers", "POST", "google"],
    ["/api/v1/stops/s1/enrich", "POST", "google"],
    ["/api/v1/places/p1/photo", "GET", "photo"],
    // DB-only routes and reads stay in the cheap tier.
    ["/api/v1/itinerary/i1", "GET", "default"],
    ["/api/v1/itinerary/i1", "DELETE", "default"],
    ["/api/v1/days/d1/stops/s1/candidates-history", "GET", "default"],
    ["/api/v1/stops/reorder", "POST", "default"],
    ["/api/v1/exchange-rate", "GET", "default"],
    // Only POST hits the expensive handler on these paths.
    ["/api/v1/places/search", "GET", "default"],
  ])("%s %s -> %s", (path, method, tier) => {
    expect(classifyApiPath(path, method)).toBe(tier);
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip, then a shared bucket", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("createMemoryStore", () => {
  const rule = { limit: 3, windowMs: 60_000 };
  const t0 = 1_000_000 * 60_000; // aligned to a window start

  it("allows up to the limit, then blocks with a Retry-After", () => {
    const store = createMemoryStore();
    expect(store.hit("k", rule, t0).allowed).toBe(true);
    expect(store.hit("k", rule, t0 + 1).allowed).toBe(true);
    expect(store.hit("k", rule, t0 + 2).remaining).toBe(0);
    const blocked = store.hit("k", rule, t0 + 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("keeps keys independent", () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) store.hit("a", rule, t0);
    expect(store.hit("a", rule, t0).allowed).toBe(false);
    expect(store.hit("b", rule, t0).allowed).toBe(true);
  });

  it("doesn't reset the moment a new window starts (no boundary burst)", () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) store.hit("k", rule, t0 + 59_000);
    // 1s into the next window the previous window still weighs ~98%.
    expect(store.hit("k", rule, t0 + 61_000).allowed).toBe(false);
  });

  it("admits again once the previous window has decayed enough", () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) store.hit("k", rule, t0);
    const blocked = store.hit("k", rule, t0 + 60_000);
    expect(blocked.allowed).toBe(false);
    const retryAt = t0 + 60_000 + blocked.retryAfterSeconds * 1000;
    expect(store.hit("k", rule, retryAt).allowed).toBe(true);
  });

  it("forgets everything after two quiet windows", () => {
    const store = createMemoryStore();
    for (let i = 0; i < 3; i++) store.hit("k", rule, t0);
    expect(store.hit("k", rule, t0 + 120_000).allowed).toBe(true);
  });

  it("doesn't count blocked requests", () => {
    const store = createMemoryStore();
    for (let i = 0; i < 10; i++) store.hit("k", rule, t0);
    // Only the 3 admitted hits carry over, so after ~1/3 of the next window
    // the estimate (3 * 2/3 = 2) leaves room again.
    expect(store.hit("k", rule, t0 + 60_000 + 21_000).allowed).toBe(true);
  });

  it("evicts the least recently used key when full", () => {
    const store = createMemoryStore(2);
    for (let i = 0; i < 3; i++) store.hit("old", rule, t0);
    store.hit("b", rule, t0);
    store.hit("c", rule, t0); // evicts "old"
    expect(store.hit("old", rule, t0).allowed).toBe(true);
  });
});

describe("createConcurrencyGate", () => {
  it("admits one per key until released", () => {
    const gate = createConcurrencyGate(1);
    expect(gate.tryAcquire("ip")).toBe(true);
    expect(gate.tryAcquire("ip")).toBe(false);
    expect(gate.tryAcquire("other")).toBe(true);
    gate.release("ip");
    expect(gate.tryAcquire("ip")).toBe(true);
  });
});

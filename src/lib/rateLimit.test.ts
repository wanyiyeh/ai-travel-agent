import { describe, expect, it } from "vitest";
import { classifyApiPath, clientIp, createMemoryGate, createMemoryStore } from "./rateLimit";
import { describeConcurrencyGate, describeRateLimitStore } from "@tests/contracts/sharedState";

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

describeRateLimitStore("memory", () => createMemoryStore());
describeConcurrencyGate("memory", (leaseMs) => createMemoryGate(leaseMs));

describe("createMemoryStore", () => {
  it("evicts the least recently used key when full", async () => {
    const rule = { limit: 3, windowMs: 60_000 };
    const t0 = 1_000_000 * 60_000;
    const store = createMemoryStore(2);
    for (let i = 0; i < 3; i++) await store.hit("old", rule, t0);
    await store.hit("b", rule, t0);
    await store.hit("c", rule, t0); // evicts "old"
    expect((await store.hit("old", rule, t0)).allowed).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { MAX_REQUEST_BODY_BYTES } from "@/lib/inputLimits";
import { RATE_LIMITS } from "@/lib/rateLimit";
import { hashIp } from "@/lib/requestFingerprint";
import { apiRateLimitStore } from "@/lib/sharedState";

function request(method: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://test/api/v1/anything", { method, headers });
}

// NextResponse.next() marks pass-through with this header rather than a status.
const passesThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy request-size guard", () => {
  it("lets a normal-sized POST through", async () => {
    expect(passesThrough(await proxy(request("POST", { "content-length": "512" })))).toBe(true);
  });

  it("lets an empty POST through", async () => {
    expect(passesThrough(await proxy(request("POST", { "content-length": "0" })))).toBe(true);
  });

  it("rejects a body over the cap with 413", async () => {
    const res = await proxy(request("PATCH", { "content-length": String(MAX_REQUEST_BODY_BYTES + 1) }));
    expect(res.status).toBe(413);
  });

  it("rejects a garbage Content-Length with 413", async () => {
    expect((await proxy(request("POST", { "content-length": "lots" }))).status).toBe(413);
  });

  it("rejects a body-carrying request with no Content-Length with 411", async () => {
    expect((await proxy(request("PUT"))).status).toBe(411);
  });

  it("ignores methods without a body", async () => {
    expect(passesThrough(await proxy(request("GET")))).toBe(true);
    expect(passesThrough(await proxy(request("DELETE")))).toBe(true);
  });
});

describe("proxy rate limit", () => {
  function fromIp(ip: string, path: string, method = "POST") {
    return new NextRequest(`http://test${path}`, {
      method,
      headers: { "x-forwarded-for": ip, "content-length": "2" },
    });
  }

  it("returns 429 with Retry-After once a client exceeds its tier", async () => {
    const ip = "203.0.113.10";
    const { limit } = RATE_LIMITS.generate;
    for (let i = 0; i < limit; i++) {
      expect(passesThrough(await proxy(fromIp(ip, "/api/v1/generate-stream")))).toBe(true);
    }
    const blocked = await proxy(fromIp(ip, "/api/v1/generate-stream"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("keeps tiers and clients separate", async () => {
    const ip = "203.0.113.11";
    for (let i = 0; i < RATE_LIMITS.generate.limit; i++) await proxy(fromIp(ip, "/api/v1/generate-stream"));
    expect((await proxy(fromIp(ip, "/api/v1/generate-stream"))).status).toBe(429);
    // Same client, cheap route: unaffected.
    expect(passesThrough(await proxy(fromIp(ip, "/api/v1/itinerary/i1", "GET")))).toBe(true);
    // Different client, same route: unaffected.
    expect(passesThrough(await proxy(fromIp("203.0.113.12", "/api/v1/generate-stream")))).toBe(true);
  });

  // The store is a database table: the raw IP may not be kept there (#279).
  it("keys the count by the IP's hash, never the IP itself", async () => {
    const hit = vi.spyOn(apiRateLimitStore, "hit");
    await proxy(fromIp("203.0.113.13", "/api/v1/generate-stream"));
    const key = hit.mock.calls[0][0];
    expect(key).not.toContain("203.0.113.13");
    expect(key).toBe(`generate:${hashIp("203.0.113.13")}`);
    hit.mockRestore();
  });
});

// Story: a page on another site makes a visitor's browser POST to our API,
// riding on their session or guest cookie (CSRF). The browser marks where
// the request came from; anything not from our own pages is refused (#212).
describe("proxy cross-site writes", () => {
  const write = (method: string, headers: Record<string, string>, path = "/api/v1/itinerary/i1") =>
    proxy(new NextRequest(`http://test${path}`, { method, headers: { "content-length": "2", ...headers } }));

  it("lets our own pages write", async () => {
    expect(passesThrough(await write("POST", { "sec-fetch-site": "same-origin", origin: "http://test" }))).toBe(true);
    expect(passesThrough(await write("PATCH", { origin: "http://test" }))).toBe(true);
  });

  it("refuses a write from another site, by Sec-Fetch-Site or by Origin", async () => {
    expect((await write("POST", { "sec-fetch-site": "cross-site", origin: "https://evil.example" })).status).toBe(403);
    expect((await write("DELETE", { "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await write("PUT", { origin: "https://evil.example" })).status).toBe(403);
  });

  it("leaves reads, non-browser clients and Auth.js's own routes alone", async () => {
    expect(passesThrough(await proxy(new NextRequest("http://test/api/v1/itinerary/i1", { headers: { "sec-fetch-site": "cross-site" } })))).toBe(true);
    expect(passesThrough(await write("POST", {}))).toBe(true);
    expect(passesThrough(await write("POST", { "sec-fetch-site": "cross-site" }, "/api/auth/callback/google"))).toBe(true);
  });
});

describe("proxy device id", () => {
  const get = (cookie?: string) =>
    proxy(new NextRequest("http://test/api/v1/itinerary/x", { headers: cookie ? { cookie, "x-forwarded-for": "203.0.113.50" } : { "x-forwarded-for": "203.0.113.50" } }));

  it("issues an httpOnly device_id to a browser that has none", async () => {
    const res = await get();
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/device_id=[0-9a-f-]{36}/);
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("passes the new id through to this same request, so the route sees it", async () => {
    const res = await get();
    const issued = /device_id=([0-9a-f-]{36})/.exec(res.headers.get("set-cookie") ?? "")![1];
    expect(res.headers.get("x-middleware-request-cookie") ?? "").toContain(issued);
  });

  it("keeps an existing valid id and replaces a malformed one", async () => {
    expect((await get("device_id=11111111-2222-3333-4444-555555555555")).headers.get("set-cookie")).toBeNull();
    expect((await get("device_id=not-a-uuid")).headers.get("set-cookie")).toMatch(/device_id=[0-9a-f-]{36}/);
  });
});

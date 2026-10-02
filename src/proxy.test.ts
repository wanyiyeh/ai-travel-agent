import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { MAX_REQUEST_BODY_BYTES } from "@/lib/inputLimits";
import { RATE_LIMITS } from "@/lib/rateLimit";

function request(method: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://test/api/v1/anything", { method, headers });
}

// NextResponse.next() marks pass-through with this header rather than a status.
const passesThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy request-size guard", () => {
  it("lets a normal-sized POST through", () => {
    expect(passesThrough(proxy(request("POST", { "content-length": "512" })))).toBe(true);
  });

  it("lets an empty POST through", () => {
    expect(passesThrough(proxy(request("POST", { "content-length": "0" })))).toBe(true);
  });

  it("rejects a body over the cap with 413", () => {
    const res = proxy(request("PATCH", { "content-length": String(MAX_REQUEST_BODY_BYTES + 1) }));
    expect(res.status).toBe(413);
  });

  it("rejects a garbage Content-Length with 413", () => {
    expect(proxy(request("POST", { "content-length": "lots" })).status).toBe(413);
  });

  it("rejects a body-carrying request with no Content-Length with 411", () => {
    expect(proxy(request("PUT")).status).toBe(411);
  });

  it("ignores methods without a body", () => {
    expect(passesThrough(proxy(request("GET")))).toBe(true);
    expect(passesThrough(proxy(request("DELETE")))).toBe(true);
  });
});

describe("proxy rate limit", () => {
  function fromIp(ip: string, path: string, method = "POST") {
    return new NextRequest(`http://test${path}`, {
      method,
      headers: { "x-forwarded-for": ip, "content-length": "2" },
    });
  }

  it("returns 429 with Retry-After once a client exceeds its tier", () => {
    const ip = "203.0.113.10";
    const { limit } = RATE_LIMITS.generate;
    for (let i = 0; i < limit; i++) {
      expect(passesThrough(proxy(fromIp(ip, "/api/v1/generate-stream")))).toBe(true);
    }
    const blocked = proxy(fromIp(ip, "/api/v1/generate-stream"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("keeps tiers and clients separate", () => {
    const ip = "203.0.113.11";
    for (let i = 0; i < RATE_LIMITS.generate.limit; i++) proxy(fromIp(ip, "/api/v1/generate-stream"));
    expect(proxy(fromIp(ip, "/api/v1/generate-stream")).status).toBe(429);
    // Same client, cheap route: unaffected.
    expect(passesThrough(proxy(fromIp(ip, "/api/v1/itinerary/i1", "GET")))).toBe(true);
    // Different client, same route: unaffected.
    expect(passesThrough(proxy(fromIp("203.0.113.12", "/api/v1/generate-stream")))).toBe(true);
  });
});

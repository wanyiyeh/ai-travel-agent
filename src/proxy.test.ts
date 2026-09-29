import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { MAX_REQUEST_BODY_BYTES } from "@/lib/inputLimits";

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

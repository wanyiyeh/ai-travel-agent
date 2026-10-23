import { NextResponse, type NextRequest } from "next/server";
import { MAX_REQUEST_BODY_BYTES } from "@/lib/inputLimits";
import { RATE_LIMITS, classifyApiPath, clientIp } from "@/lib/rateLimit";
import { apiRateLimitStore } from "@/lib/sharedState";

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Auth.js checks its own requests (CSRF token, OAuth state).
const AUTH_PATH_PREFIX = "/api/auth/";

/**
 * Whether a browser sent this write from another site (CSRF, #212). Both
 * headers are set by the browser and can't be changed by a page. A request
 * with neither didn't come from a browser; it can't ride on a visitor's
 * cookies, and the rate limits and quotas still apply to it.
 */
export function isCrossSiteWrite(request: NextRequest): boolean {
  if (!WRITE_METHODS.has(request.method) || request.nextUrl.pathname.startsWith(AUTH_PATH_PREFIX)) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite !== "same-origin";
  const origin = request.headers.get("origin");
  return origin !== null && origin !== request.nextUrl.origin;
}
const DEVICE_COOKIE = "device_id";
const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function proxy(request: NextRequest) {
  if (isCrossSiteWrite(request)) {
    return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }

  // Per-client rate limit first, keyed by IP + cost tier, so a client
  // looping on an OpenAI/Google route gets a 429 before the route runs.
  const tier = classifyApiPath(request.nextUrl.pathname, request.method);
  const rule = RATE_LIMITS[tier];
  const result = await apiRateLimitStore.hit(`${tier}:${clientIp(request.headers)}`, rule);
  if (!result.allowed) {
    return NextResponse.json(
      { error: "Too many requests", retryAfterSeconds: result.retryAfterSeconds },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfterSeconds),
          "X-RateLimit-Limit": String(rule.limit),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  // Rejects oversized API request bodies before any route calls
  // request.json(), so a caller can't make the server buffer and parse
  // megabytes of JSON. Browsers always send Content-Length for a fetch body
  // (0 when there is none); a request without one is a chunked upload from a
  // custom client, which this app never needs.
  if (METHODS_WITH_BODY.has(request.method)) {
    const header = request.headers.get("content-length");
    if (header === null) {
      return NextResponse.json({ error: "Content-Length required" }, { status: 411 });
    }
    const length = Number(header);
    if (!Number.isFinite(length) || length > MAX_REQUEST_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
  }

  // A long-lived per-browser id, so usage quotas can be shared across every
  // account used in the same browser (plan/access-control.md §3). Issued on
  // the first API request and also injected into this request's cookies, so
  // the route already sees it. Not signed: forging one is no better than
  // clearing it, and both just land on the per-IP and site-wide caps.
  let deviceId = request.cookies.get(DEVICE_COOKIE)?.value;
  const issueDeviceId = !deviceId || !DEVICE_ID_RE.test(deviceId);
  if (issueDeviceId) {
    deviceId = crypto.randomUUID();
    request.cookies.set(DEVICE_COOKIE, deviceId);
  }

  const response = NextResponse.next({ request: { headers: request.headers } });
  if (issueDeviceId) {
    response.cookies.set(DEVICE_COOKIE, deviceId!, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
      secure: process.env.NODE_ENV === "production",
    });
  }
  response.headers.set("X-RateLimit-Limit", String(rule.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  return response;
}

export const config = {
  matcher: "/api/:path*",
};

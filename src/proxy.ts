import { NextResponse, type NextRequest } from "next/server";
import { MAX_REQUEST_BODY_BYTES } from "@/lib/inputLimits";
import { RATE_LIMITS, apiRateLimitStore, classifyApiPath, clientIp } from "@/lib/rateLimit";

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

export function proxy(request: NextRequest) {
  // Per-client rate limit first, keyed by IP + cost tier, so a client
  // looping on an OpenAI/Google route gets a 429 before the route runs.
  const tier = classifyApiPath(request.nextUrl.pathname, request.method);
  const rule = RATE_LIMITS[tier];
  const result = apiRateLimitStore.hit(`${tier}:${clientIp(request.headers)}`, rule);
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

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(rule.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  return response;
}

export const config = {
  matcher: "/api/:path*",
};

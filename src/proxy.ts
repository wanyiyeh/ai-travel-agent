import { NextResponse, type NextRequest } from "next/server";
import { MAX_REQUEST_BODY_BYTES } from "@/lib/inputLimits";

const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

// Rejects oversized API request bodies before any route calls
// request.json(), so a caller can't make the server buffer and parse
// megabytes of JSON. Browsers always send Content-Length for a fetch body
// (0 when there is none); a request without one is a chunked upload from a
// custom client, which this app never needs.
export function proxy(request: NextRequest) {
  if (!METHODS_WITH_BODY.has(request.method)) return NextResponse.next();

  const header = request.headers.get("content-length");
  if (header === null) {
    return NextResponse.json({ error: "Content-Length required" }, { status: 411 });
  }
  const length = Number(header);
  if (!Number.isFinite(length) || length > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};

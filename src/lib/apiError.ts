import { NextResponse } from "next/server";

// A short id tying a client-visible error to its server log line.
export function newRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// For unexpected failures in an API route. The raw error (Prisma messages,
// upstream API responses, stack traces) goes only to the server log; the
// caller gets a generic message plus the request id to look that log up by.
// Don't use this for validation failures — those describe the caller's own
// input and are fine to echo back.
export function internalErrorResponse(label: string, error: unknown, message: string, status = 500) {
  const requestId = newRequestId();
  console.error(`[${label}] requestId=${requestId}`, error);
  return NextResponse.json({ error: message, requestId }, { status });
}

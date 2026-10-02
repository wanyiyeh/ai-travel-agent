import { afterEach, describe, expect, it, vi } from "vitest";
import { internalErrorResponse, newRequestId } from "./apiError";

afterEach(() => vi.restoreAllMocks());

describe("internalErrorResponse", () => {
  it("logs the raw error server-side but returns only a generic message and request id", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = new Error("PrismaClientKnownRequestError at C:\Users\whps4\ai-travel-agent\prisma\dev.db");

    const res = internalErrorResponse("Test Route", secret, "Failed to do the thing");
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Failed to do the thing", requestId: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain("Prisma");
    // The same id appears in the log line, so it can be looked up.
    expect(log).toHaveBeenCalledWith(`[Test Route] requestId=${body.requestId}`, secret);
  });

  it("keeps a non-500 status when given one", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(internalErrorResponse("x", new Error("y"), "z", 502).status).toBe(502);
  });

  it("generates short, distinct ids", () => {
    const a = newRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(newRequestId()).not.toBe(a);
  });
});

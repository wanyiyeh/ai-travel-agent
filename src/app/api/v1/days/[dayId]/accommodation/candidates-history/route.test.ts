import { describe, expect, it, vi } from "vitest";
import { signInAs } from "@tests/setup/mockAuth";

// A DB failure must not reach the client verbatim (paths, query details).
vi.mock("@/lib/db", () => ({
  prisma: {
    // The caller owns this itinerary, so the request gets as far as the logs.
    itinerary: { findFirst: async () => ({ id: "i1", userId: "u1" }) },
    accommodationCandidateLog: {
      findMany: async () => {
        throw new Error("SQLITE_CANTOPEN: unable to open C:\secret\dev.db");
      },
    },
  },
}));

const { GET } = await import("./route");

describe("GET accommodation candidates-history on a DB failure", () => {
  it("returns a generic 500 without the underlying error text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signInAs({ id: "u1", email: "u1@example.com" });
    const res = await GET(new Request("http://test/api?itineraryId=i1"), { params: Promise.resolve({ dayId: "d1" }) });
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(text).not.toContain("SQLITE");
    expect(text).not.toContain("secret");
    expect(JSON.parse(text).requestId).toEqual(expect.any(String));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { signInAs } from "@tests/setup/mockAuth";

// Validation runs before any DB access; an itinerary the signed-in user
// doesn't own then 404s. So 400 = rejected by the schema, 404 = accepted and
// looked up (ownership-scoped), 401 = signed out.
const findFirst = vi.fn(async () => null);
vi.mock("@/lib/db", () => ({ prisma: { itinerary: { findFirst } }, j: (v: unknown) => v }));
vi.mock("@/lib/placeCache", () => ({ upsertPlace: async () => {} }));

const { PATCH, DELETE } = await import("./route");

const params = { params: Promise.resolve({ stopId: "s1" }) };
const req = (method: string, body: unknown) =>
  new Request("http://test/api", { method, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  findFirst.mockClear();
  signInAs({ id: "u1", email: "u1@example.com" });
});

describe("PATCH /stops/[stopId] validation", () => {
  it("accepts the edit-form payload, including a cleared cost", async () => {
    const res = await PATCH(
      req("PATCH", { itineraryId: "i1", name: "淺草寺", description: "古寺", duration_minutes: 90, estimated_cost: null }),
      params,
    );
    expect(res.status).toBe(404);
  });

  it("accepts the picker's place-swap payload with nulls", async () => {
    const res = await PATCH(
      req("PATCH", {
        itineraryId: "i1", name: "x", description: "y", duration_minutes: 60, estimated_cost: null,
        placeId: null, address: "addr", rating: null, photoName: null,
      }),
      params,
    );
    expect(res.status).toBe(404);
  });

  it.each([
    ["missing itineraryId", { name: "x" }],
    ["non-numeric duration", { itineraryId: "i1", duration_minutes: "90" }],
    ["negative cost", { itineraryId: "i1", estimated_cost: -5 }],
    ["out-of-range latitude", { itineraryId: "i1", placeId: "p", lat: 500, lng: 0 }],
    ["rating above 5", { itineraryId: "i1", placeId: "p", rating: 99 }],
    ["object as name", { itineraryId: "i1", name: { $ne: 1 } }],
    ["oversized description", { itineraryId: "i1", description: "x".repeat(5000) }],
  ])("rejects %s with 400 before touching the DB", async (_label, body) => {
    const res = await PATCH(req("PATCH", body), params);
    expect(res.status).toBe(400);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400 instead of 500", async () => {
    expect((await PATCH(req("PATCH", "{not json"), params)).status).toBe(400);
  });
});

describe("DELETE /stops/[stopId] validation", () => {
  it("requires a string itineraryId", async () => {
    expect((await DELETE(req("DELETE", { itineraryId: 123 }), params)).status).toBe(400);
    expect((await DELETE(req("DELETE", { itineraryId: "i1" }), params)).status).toBe(404);
  });
});

describe("stops/[stopId] ownership", () => {
  it("rejects a signed-out caller with 401 before any lookup", async () => {
    signInAs(null);
    const res = await PATCH(req("PATCH", { itineraryId: "i1", name: "x" }), params);
    expect(res.status).toBe(401);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("only looks the itinerary up scoped to the caller", async () => {
    await DELETE(req("DELETE", { itineraryId: "i1" }), params);
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "i1", userId: "u1" } });
  });
});

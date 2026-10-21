import { beforeEach, describe, expect, it, vi } from "vitest";
import { signInAs } from "@tests/setup/mockAuth";

// Validation runs before any DB access; an itinerary the signed-in user
// doesn't own then 404s. So 400 = rejected by the schema, 404 = accepted and
// looked up (ownership-scoped), 401 = signed out.
const findFirst = vi.fn<() => Promise<unknown>>(async () => null);
const update = vi.fn(async () => ({}));
vi.mock("@/lib/db", () => ({ prisma: { itinerary: { findFirst, update }, user: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id }) } }, j: (v: unknown) => v }));
vi.mock("@/lib/placeCache", () => ({ upsertPlace: async () => {} }));

const { PATCH, DELETE } = await import("./route");

const params = { params: Promise.resolve({ stopId: "s1" }) };
const req = (method: string, body: unknown) =>
  new Request("http://test/api", { method, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  findFirst.mockReset();
  findFirst.mockResolvedValue(null);
  update.mockClear();
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
    expect(findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "i1", userId: "u1" }) });
  });
});

// A booked event (固定行程) isn't swapped for another place — the UI hides 換一個, and so does the server.
describe("PATCH /stops/[stopId] — a booked event", () => {
  beforeEach(() => {
    findFirst.mockResolvedValue({
      id: "i1",
      userId: "u1",
      days: [
        {
          id: "d1",
          stops: [{ id: "s1", name: "東京巨蛋", placeId: "dome", fixedEvent: { type: "concert", startTime: "18:00", endTime: "21:00" } }],
        },
      ],
    });
  });

  it("refuses a swap to another place", async () => {
    const res = await PATCH(req("PATCH", { itineraryId: "i1", name: "東京鐵塔", placeId: "tower", lat: 35.65, lng: 139.74 }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("固定行程不能換成別的地點");
    expect(update).not.toHaveBeenCalled();
  });

  it("still takes an edit of its text", async () => {
    const res = await PATCH(req("PATCH", { itineraryId: "i1", name: "東京巨蛋", description: "提早一小時到" }), params);
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalled();
  });
});


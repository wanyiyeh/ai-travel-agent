import { beforeEach, describe, expect, it, vi } from "vitest";
import { signInAs } from "@tests/setup/mockAuth";

const findFirst = vi.fn(async () => null);
vi.mock("@/lib/db", () => ({ prisma: { itinerary: { findFirst } }, j: (v: unknown) => v }));

beforeEach(() => signInAs({ id: "u1", email: "u1@example.com" }));

const { POST } = await import("./route");

const req = (body: unknown) => new Request("http://test/api", { method: "POST", body: JSON.stringify(body) });

describe("POST /stops/reorder validation", () => {
  it("accepts the drag-and-drop payload", async () => {
    const res = await POST(req({ itineraryId: "i1", days: [{ dayId: "d1", stopIds: ["a", "b"] }, { dayId: "d2", stopIds: [] }] }));
    expect(res.status).toBe(404);
  });

  it.each([
    ["days not an array", { itineraryId: "i1", days: "d1" }],
    ["non-string stop id", { itineraryId: "i1", days: [{ dayId: "d1", stopIds: [1] }] }],
    ["missing dayId", { itineraryId: "i1", days: [{ stopIds: ["a"] }] }],
    ["too many stop ids", { itineraryId: "i1", days: [{ dayId: "d1", stopIds: Array(501).fill("a") }] }],
  ])("rejects %s with 400", async (_label, body) => {
    findFirst.mockClear();
    expect((await POST(req(body))).status).toBe(400);
    expect(findFirst).not.toHaveBeenCalled();
  });
});

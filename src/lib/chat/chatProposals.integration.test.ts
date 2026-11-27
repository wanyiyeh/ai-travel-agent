import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, j } from "@/lib/db";
import { signInAs } from "@tests/setup/mockAuth";
import * as proposalRoute from "@/app/api/v1/itinerary/[id]/chat/proposals/[proposalId]/route";
import * as mealRegenerateRoute from "@/app/api/v1/days/[dayId]/meals/[mealType]/regenerate/route";

// Story: the owner confirms or cancels the chat's proposal cards. A one-step
// change is applied once however often it's confirmed; a change that needs a
// pick opens the picker and counts once the pick is reported; a card the trip
// has moved past turns stale. 「換一家拉麵」 puts ramen places first.

const stamp = Date.now();
const owner = { id: `cp-owner-${stamp}`, email: `cp-owner-${stamp}@example.com` };
const stranger = { id: `cp-stranger-${stamp}`, email: `cp-stranger-${stamp}@example.com` };
const itineraryId = `cp-trip-${stamp}`;
const otherTripId = `cp-other-${stamp}`;

const startDays = () => [
  {
    id: "d1",
    day: 1,
    waypointCity: "東京",
    stops: [
      { id: "s1", name: "自己的景點一", duration_minutes: 60, lat: 35.71, lng: 139.79 },
      { id: "s2", name: "自己的景點二", duration_minutes: 60, lat: 35.72, lng: 139.8 },
    ],
    meals: { dinner: { name: "自己的晚餐", description: "", lat: 35.71, lng: 139.79 } },
  },
];

async function proposal(action: string, params: unknown, tripId = itineraryId) {
  const message = await prisma.chatMessage.create({
    data: { itineraryId: tripId, role: "assistant", category: "edit", content: "r", proposals: { create: [{ action, params: j(params) }] } },
    include: { proposals: true },
  });
  return message.proposals[0].id;
}

const decide = (proposalId: string, decision: string, tripId = itineraryId) =>
  proposalRoute.POST(new Request("http://test", { method: "POST", body: JSON.stringify({ decision }) }), {
    params: Promise.resolve({ id: tripId, proposalId }),
  });

const statusOf = async (id: string) => (await prisma.chatProposal.findUniqueOrThrow({ where: { id } })).status;
const tripDays = async () =>
  (await prisma.itinerary.findUniqueOrThrow({ where: { id: itineraryId } })).days as unknown as ReturnType<typeof startDays>;

beforeAll(async () => {
  await prisma.user.createMany({ data: [owner, stranger] });
  await prisma.itinerary.createMany({
    data: [
      { id: itineraryId, userId: owner.id, title: "東京", config: j({}), days: j(startDays()) },
      { id: otherTripId, userId: stranger.id, title: "別人的", config: j({}), days: j(startDays()) },
    ],
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
});

beforeEach(async () => {
  await prisma.chatMessage.deleteMany({ where: { itineraryId } });
  await prisma.deletedStop.deleteMany({ where: { itineraryId } });
  await prisma.itinerary.update({ where: { id: itineraryId }, data: { days: j(startDays()) } });
  signInAs(owner);
});

describe("chat proposal decisions", () => {
  it("applies a one-step change once, keeping the removed stop in the trash", async () => {
    const id = await proposal("remove_stop", { dayId: "d1", stopId: "s2" });
    const res = await decide(id, "confirm");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "applied", recalculateDayId: "d1" });
    expect((await tripDays())[0].stops.map((s) => s.id)).toEqual(["s1"]);
    expect(await prisma.deletedStop.count({ where: { itineraryId } })).toBe(1);

    const again = await decide(id, "confirm");
    expect(again.status).toBe(409);
    expect(await prisma.deletedStop.count({ where: { itineraryId } })).toBe(1);
  });

  it("applies a double confirm sent at once only once", async () => {
    const id = await proposal("move_stop", { dayId: "d1", stopId: "s1", toIndex: 1 });
    const results = await Promise.all([decide(id, "confirm"), decide(id, "confirm")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await tripDays())[0].stops.map((s) => s.id)).toEqual(["s2", "s1"]);
  });

  it("cancels without touching the trip", async () => {
    const id = await proposal("remove_stop", { dayId: "d1", stopId: "s1" });
    expect(await (await decide(id, "cancel")).json()).toEqual({ status: "cancelled" });
    expect(await statusOf(id)).toBe("cancelled");
    expect((await tripDays())[0].stops).toHaveLength(2);
    expect((await decide(id, "confirm")).status).toBe(409);
  });

  it("turns a card stale when the trip moved on", async () => {
    const id = await proposal("remove_stop", { dayId: "d1", stopId: "already-gone" });
    const res = await decide(id, "confirm");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ status: "stale", code: "proposal_stale" });
    expect(await statusOf(id)).toBe("stale");
  });

  it("opens the picker for a change that needs a pick, and counts it once picked", async () => {
    const id = await proposal("replace_meal", { dayId: "d1", mealType: "dinner", request: "拉麵" });
    expect(await (await decide(id, "confirm")).json()).toEqual({
      status: "pending",
      picker: { picker: "meal", dayId: "d1", mealType: "dinner", request: "拉麵" },
    });
    expect(await statusOf(id)).toBe("pending");
    expect(await (await decide(id, "picked")).json()).toEqual({ status: "applied" });
    expect(await statusOf(id)).toBe("applied");
  });

  it("hands a restructure to the screen with a preview, and turns it stale when the route no longer fits", async () => {
    // The trip is a single 東京 day; 東京 goes 1 → 2 and 大阪 is added after it.
    const id = await proposal("restructure", { cities: [{ name: "東京", days: 2, isNew: false }, { name: "大阪", days: 2, isNew: true }] });
    const body = await (await decide(id, "confirm")).json();
    expect(body).toMatchObject({
      status: "pending",
      restructure: {
        request: { cities: [{ name: "東京", isNew: false, keepDayIds: ["d1"] }, { name: "大阪", isNew: true, targetDays: 2 }] },
        preview: [{ name: "東京", daysBefore: 1, daysAfter: 2 }, { name: "大阪", isNew: true, newDays: 2 }],
      },
    });
    expect(await statusOf(id)).toBe("pending");
    expect(await (await decide(id, "picked")).json()).toEqual({ status: "applied" });

    const stale = await proposal("restructure", { cities: [{ name: "京都", days: 3, isNew: false }] });
    expect((await decide(stale, "confirm")).status).toBe(409);
    expect(await statusOf(stale)).toBe("stale");
  });

  it("won't take a pick for a one-step change", async () => {
    const id = await proposal("remove_stop", { dayId: "d1", stopId: "s1" });
    expect((await decide(id, "picked")).status).toBe(400);
    expect(await statusOf(id)).toBe("pending");
  });

  it("is the owner's only", async () => {
    const theirs = await proposal("remove_stop", { dayId: "d1", stopId: "s1" }, otherTripId);
    expect((await decide(theirs, "confirm", otherTripId)).status).toBe(404); // not my trip
    expect((await decide(theirs, "confirm")).status).toBe(404); // not on my trip
    expect(await statusOf(theirs)).toBe("pending");
  });
});

describe("meal picker with the traveler's wording", () => {
  it("lists places matching the wording first", async () => {
    vi.stubEnv("MOCK_AI", "");
    vi.stubEnv("MOCK_PLACES", "1");
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "mock-key");
    try {
      const res = await mealRegenerateRoute.POST(
        new Request("http://test", { method: "POST", body: JSON.stringify({ itineraryId, request: "拉麵" }) }),
        { params: Promise.resolve({ dayId: "d1", mealType: "dinner" }) },
      );
      expect(res.status).toBe(200);
      const { candidates } = (await res.json()) as { candidates: { name: string; isCurrent?: boolean }[] };
      expect(candidates[0]).toMatchObject({ name: "自己的晚餐", isCurrent: true });
      expect(candidates[1].name).toBe("拉麵");
    } finally {
      vi.stubEnv("MOCK_AI", "1");
      vi.stubEnv("MOCK_PLACES", "");
      vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    }
  });
});

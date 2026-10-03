import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, j } from "@/lib/db";
import { signInAs } from "@tests/setup/mockAuth";

import * as itineraryRoute from "@/app/api/v1/itinerary/[id]/route";
import * as stopRoute from "@/app/api/v1/stops/[stopId]/route";
import * as reorderRoute from "@/app/api/v1/stops/reorder/route";
import * as trashRoute from "@/app/api/v1/itinerary/[id]/trash/route";
import * as trashItemRoute from "@/app/api/v1/itinerary/[id]/trash/[deletedStopId]/route";
import * as trashRestoreRoute from "@/app/api/v1/itinerary/[id]/trash/[deletedStopId]/restore/route";
import * as stopHistoryRoute from "@/app/api/v1/days/[dayId]/stops/[stopId]/candidates-history/route";
import * as removeWaypointRoute from "@/app/api/v1/itinerary/[id]/remove-waypoint/route";

// Story: Bob owns an itinerary. Alice is signed in and knows its id (e.g. from
// a shared link). Every way of reading or changing it must answer 404 for
// her — the same as an id that doesn't exist — and must leave Bob's data
// untouched. Bob himself keeps full access. plan/access-control.md §6.

const stamp = Date.now();
const alice = { id: `alice-${stamp}`, email: `alice-${stamp}@example.com` };
const bob = { id: `bob-${stamp}`, email: `bob-${stamp}@example.com` };
const itineraryId = `itin-${stamp}`;
const dayId = `day-${stamp}`;
const stopIds = [`stop-a-${stamp}`, `stop-b-${stamp}`];
let trashId = "";

const json = (method: string, body: unknown) =>
  new Request("http://test/api", { method, body: JSON.stringify(body) });
const p = <T,>(v: T) => ({ params: Promise.resolve(v) });

beforeAll(async () => {
  await prisma.user.createMany({ data: [alice, bob] });
  await prisma.itinerary.create({
    data: {
      id: itineraryId,
      userId: bob.id,
      title: "Bob's trip",
      config: j({}),
      days: j([{ id: dayId, day: 1, stops: stopIds.map((id, i) => ({ id, name: `景點 ${i}`, orderIndex: i })) }]),
    },
  });
  const trashed = await prisma.deletedStop.create({
    data: { itineraryId, dayId, dayNumber: 1, originalIndex: 2, stop: j({ id: `stop-c-${stamp}`, name: "垃圾桶裡的景點" }) },
  });
  trashId = trashed.id;
  await prisma.stopCandidateLog.create({ data: { itineraryId, dayId, stopId: stopIds[0], candidates: j([]) } });
});

afterAll(async () => {
  await prisma.itinerary.deleteMany({ where: { id: itineraryId } });
  await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } });
});

async function bobsDays() {
  const row = await prisma.itinerary.findUnique({ where: { id: itineraryId } });
  return row?.days as { stops: { id: string; name: string }[] }[] | undefined;
}

describe("another signed-in user cannot touch Bob's itinerary", () => {
  it.each([
    ["GET itinerary", () => itineraryRoute.GET(new Request("http://test"), p({ id: itineraryId }))],
    ["DELETE itinerary", () => itineraryRoute.DELETE(new Request("http://test"), p({ id: itineraryId }))],
    ["PATCH stop", () => stopRoute.PATCH(json("PATCH", { itineraryId, name: "被改掉了" }), p({ stopId: stopIds[0] }))],
    ["DELETE stop", () => stopRoute.DELETE(json("DELETE", { itineraryId }), p({ stopId: stopIds[0] }))],
    ["reorder stops", () => reorderRoute.POST(json("POST", { itineraryId, days: [{ dayId, stopIds: [stopIds[1]] }] }))],
    ["list trash", () => trashRoute.GET(new Request("http://test"), p({ id: itineraryId }))],
    ["purge trash item", () => trashItemRoute.DELETE(new Request("http://test"), p({ id: itineraryId, deletedStopId: trashId }))],
    ["restore trash item", () => trashRestoreRoute.POST(new Request("http://test"), p({ id: itineraryId, deletedStopId: trashId }))],
    ["read candidate history", () => stopHistoryRoute.GET(new Request(`http://test?itineraryId=${itineraryId}`), p({ dayId, stopId: stopIds[0] }))],
    ["remove waypoint", () => removeWaypointRoute.DELETE(json("DELETE", { transitTo: "大阪" }), p({ id: itineraryId }))],
  ])("%s → 404", async (_label, call) => {
    signInAs(alice);
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("left Bob's itinerary, trash and history exactly as they were", async () => {
    const days = await bobsDays();
    expect(days?.[0].stops.map((s) => s.id)).toEqual(stopIds);
    expect(days?.[0].stops[0].name).toBe("景點 0");
    expect(await prisma.deletedStop.count({ where: { id: trashId } })).toBe(1);
  });

  it("answers a signed-out caller with 401", async () => {
    signInAs(null);
    expect((await itineraryRoute.GET(new Request("http://test"), p({ id: itineraryId }))).status).toBe(401);
  });
});

describe("the owner keeps full access", () => {
  it("can read, edit, and see the trash", async () => {
    signInAs(bob);
    expect((await itineraryRoute.GET(new Request("http://test"), p({ id: itineraryId }))).status).toBe(200);

    const patched = await stopRoute.PATCH(json("PATCH", { itineraryId, name: "Bob 改的" }), p({ stopId: stopIds[0] }));
    expect(patched.status).toBe(200);
    expect((await bobsDays())?.[0].stops[0].name).toBe("Bob 改的");

    const trash = await trashRoute.GET(new Request("http://test"), p({ id: itineraryId }));
    expect(trash.status).toBe(200);
    expect((await trash.json()).entries).toHaveLength(1);
  });
});

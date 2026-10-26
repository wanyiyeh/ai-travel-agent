import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, j } from "@/lib/db";
import { setTestCookie, signInAs } from "@tests/setup/mockAuth";
import { GUEST_COOKIE, signGuestId } from "@/lib/auth/guest";
import { DELETE } from "./route";

// Story: Carol deletes her account from the account page. Everything that's
// hers goes, at once; Dave's data, next to hers, stays (#283).

const stamp = Date.now();
const carol = { id: `carol-${stamp}`, email: `carol-${stamp}@example.com` };
const dave = { id: `dave-${stamp}`, email: `dave-${stamp}@example.com` };
const guestId = `guest-del-${stamp}`;
const carolTrip = `itin-carol-${stamp}`;
const daveTrip = `itin-dave-${stamp}`;

const remove = (body: unknown) => DELETE(new Request("http://test/api/v1/account", { method: "DELETE", body: JSON.stringify(body) }));

async function seed() {
  await prisma.user.deleteMany({ where: { id: { in: [carol.id, dave.id, guestId] } } });
  await prisma.usageEvent.deleteMany({ where: { userId: { in: [carol.id, dave.id] } } });
  await prisma.user.createMany({ data: [carol, dave, { id: guestId, isGuest: true }] });
  for (const [id, userId] of [[carolTrip, carol.id], [daveTrip, dave.id]]) {
    await prisma.itinerary.create({ data: { id, userId, title: "trip", config: j({}), days: j([{ id: `${id}-d1`, day: 1, stops: [] }]) } });
    await prisma.deletedStop.create({ data: { itineraryId: id, dayId: `${id}-d1`, dayNumber: 1, originalIndex: 0, stop: j({ id: "s", name: "x" }) } });
    await prisma.stopCandidateLog.create({ data: { itineraryId: id, dayId: `${id}-d1`, stopId: "s", candidates: j([]) } });
  }
  await prisma.usageEvent.createMany({
    data: [
      { kind: "generate", userId: carol.id, ipHash: "h-carol" },
      { kind: "generate", userId: dave.id, ipHash: "h-dave" },
    ],
  });
}

beforeEach(seed);

afterAll(async () => {
  await prisma.usageEvent.deleteMany({ where: { userId: { in: [carol.id, dave.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [carol.id, dave.id, guestId] } } });
});

describe("DELETE /api/v1/account", () => {
  it("deletes the account, its trips, trash, candidate logs and usage records", async () => {
    signInAs(carol);

    const res = await remove({ confirmEmail: ` ${carol.email.toUpperCase()} ` });

    expect(res.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: carol.id } })).toBeNull();
    expect(await prisma.itinerary.count({ where: { id: carolTrip } })).toBe(0);
    expect(await prisma.deletedStop.count({ where: { itineraryId: carolTrip } })).toBe(0);
    expect(await prisma.stopCandidateLog.count({ where: { itineraryId: carolTrip } })).toBe(0);
    expect(await prisma.usageEvent.count({ where: { userId: carol.id } })).toBe(0);
  });

  it("leaves everyone else's data alone", async () => {
    signInAs(carol);
    await remove({ confirmEmail: carol.email });

    expect(await prisma.user.findUnique({ where: { id: dave.id } })).not.toBeNull();
    expect(await prisma.itinerary.count({ where: { id: daveTrip } })).toBe(1);
    expect(await prisma.deletedStop.count({ where: { itineraryId: daveTrip } })).toBe(1);
    expect(await prisma.usageEvent.count({ where: { userId: dave.id } })).toBe(1);
  });

  it("refuses an email that isn't the account's, deleting nothing", async () => {
    signInAs(carol);

    expect((await remove({ confirmEmail: dave.email })).status).toBe(400);
    expect((await remove({})).status).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: carol.id } })).not.toBeNull();
    expect(await prisma.itinerary.count({ where: { id: carolTrip } })).toBe(1);
  });

  it("refuses a guest and a signed-out visitor", async () => {
    setTestCookie(GUEST_COOKIE, signGuestId(guestId));
    expect((await remove({ confirmEmail: "" })).status).toBe(401);
    setTestCookie(GUEST_COOKIE, null);
    expect((await remove({ confirmEmail: carol.email })).status).toBe(401);
    expect(await prisma.user.findUnique({ where: { id: guestId } })).not.toBeNull();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, j } from "@/lib/db";
import { setTestCookie, signInAs } from "@tests/setup/mockAuth";
import { GUEST_COOKIE, claimGuestItineraries, signGuestId } from "./guest";
import * as itineraryRoute from "@/app/api/v1/itinerary/[id]/route";

// Story: a visitor generates a trip without signing in. They can keep using
// it through their guest cookie, nobody else can, it disappears after its
// expiry, and signing in moves it to their account for good.
// plan/access-control.md §5, §7.

process.env.AUTH_SECRET ??= "integration-test-secret";

const stamp = Date.now();
const ids = {
  guest: `guest-${stamp}`,
  otherGuest: `guest-other-${stamp}`,
  user: `user-${stamp}`,
  live: `itin-live-${stamp}`,
  expired: `itin-expired-${stamp}`,
};
const user = { id: ids.user, email: `claim-${stamp}@example.com` };
const p = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => itineraryRoute.GET(new Request("http://test"), p(id));
const asGuest = (guestId: string) => setTestCookie(GUEST_COOKIE, signGuestId(guestId));

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: ids.guest, isGuest: true },
      { id: ids.otherGuest, isGuest: true },
      user,
    ],
  });
  const base = { userId: ids.guest, title: "Guest trip", days: j([]), config: j({}) };
  await prisma.itinerary.create({ data: { ...base, id: ids.live, expiresAt: new Date(Date.now() + 60_000) } });
  await prisma.itinerary.create({ data: { ...base, id: ids.expired, expiresAt: new Date(Date.now() - 60_000) } });
});

afterAll(async () => {
  await prisma.itinerary.deleteMany({ where: { id: { in: [ids.live, ids.expired] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.guest, ids.otherGuest, ids.user] } } });
});

describe("guest itineraries", () => {
  it("the guest can open their itinerary, and sees when it expires", async () => {
    asGuest(ids.guest);
    const res = await get(ids.live);
    expect(res.status).toBe(200);
    expect((await res.json()).expiresAt).toBeTruthy();
  });

  it("another guest gets 404, a forged cookie counts as signed out", async () => {
    asGuest(ids.otherGuest);
    expect((await get(ids.live)).status).toBe(404);

    setTestCookie(GUEST_COOKIE, `${ids.guest}.forged-mac`);
    expect((await get(ids.live)).status).toBe(401);
  });

  it("an expired itinerary reads as gone even for its owner", async () => {
    asGuest(ids.guest);
    expect((await get(ids.expired)).status).toBe(404);
  });
});

describe("signing in claims the guest's itineraries", () => {
  it("moves the live one to the account (no longer expiring) and retires the guest", async () => {
    expect(await claimGuestItineraries(ids.guest, ids.user)).toBe(1);

    const live = await prisma.itinerary.findUnique({ where: { id: ids.live } });
    expect(live?.userId).toBe(ids.user);
    expect(live?.expiresAt).toBeNull();

    expect(await prisma.user.findUnique({ where: { id: ids.guest } })).toBeNull();
    // The expired one went with the guest row (cascade), not to the account.
    expect(await prisma.itinerary.findUnique({ where: { id: ids.expired } })).toBeNull();
  });

  it("the account now opens it; the old guest cookie no longer identifies anyone", async () => {
    signInAs(user);
    expect((await get(ids.live)).status).toBe(200);

    signInAs(null);
    asGuest(ids.guest);
    expect((await get(ids.live)).status).toBe(401);
  });

  it("is a no-op for a non-guest or unknown id", async () => {
    expect(await claimGuestItineraries(ids.user, ids.otherGuest)).toBe(0);
    expect(await claimGuestItineraries("nobody", ids.user)).toBe(0);
  });
});

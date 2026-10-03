import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, j } from "@/lib/db";
import { signInAs } from "@tests/setup/mockAuth";
import { QUOTAS, checkQuota, recordUsage } from "./quota";
import { hashIp, type RequestFingerprint } from "./requestFingerprint";
import type { Actor } from "./auth/actor";
import { POST as regenerateAccommodation } from "@/app/api/v1/days/[dayId]/accommodation/regenerate/route";

// Story: the quotas are counted from real UsageEvent rows, so they hold
// across server restarts and across accounts — switching accounts on the
// same network or in the same browser doesn't reset them.
// plan/access-control.md §2–§4.

const stamp = Date.now();
const oldUser = { id: `quota-old-${stamp}`, email: `quota-old-${stamp}@example.com` };
const otherUser = { id: `quota-other-${stamp}`, email: `quota-other-${stamp}@example.com` };
const guestId = `quota-guest-${stamp}`;
const asUser = (u: { id: string; email: string }): Actor => ({ kind: "user", userId: u.id, email: u.email, isAdmin: false });
const fp = (ip: string, deviceId: string | null = null): RequestFingerprint => ({ ipHash: hashIp(ip), deviceId });

async function seed(kind: "generate" | "paid_edit", n: number, owner: { userId: string; isGuest: boolean }, f: RequestFingerprint, itineraryId?: string) {
  for (let i = 0; i < n; i++) await recordUsage(kind, owner, f, itineraryId);
}

beforeAll(async () => {
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  await prisma.user.createMany({
    data: [
      { ...oldUser, createdAt: monthAgo },
      { ...otherUser, createdAt: monthAgo },
      { id: guestId, isGuest: true },
    ],
  });
});

// test.db is test-only, and site-wide caps count every row in it.
beforeEach(async () => {
  await prisma.usageEvent.deleteMany({});
});

afterAll(async () => {
  await prisma.usageEvent.deleteMany({});
  await prisma.itinerary.deleteMany({ where: { userId: { in: [oldUser.id, guestId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [oldUser.id, otherUser.id, guestId] } } });
});

describe("generation quotas from the database", () => {
  it("counts a user's own generations over the last 24h", async () => {
    await seed("generate", QUOTAS.generate.userPerDay, { userId: oldUser.id, isGuest: false }, fp("10.0.0.1"));
    const d = await checkQuota(asUser(oldUser), "generate", fp("10.0.0.2"));
    expect(d.ok ? "ok" : d.reason).toBe("user_daily_limit");
  });

  it("ignores usage older than 24h", async () => {
    await seed("generate", QUOTAS.generate.userPerDay, { userId: oldUser.id, isGuest: false }, fp("10.0.0.1"));
    await prisma.usageEvent.updateMany({ data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    expect((await checkQuota(asUser(oldUser), "generate", fp("10.0.0.1"))).ok).toBe(true);
  });

  it("a second account on the same IP inherits the IP's count", async () => {
    await seed("generate", QUOTAS.generate.perIpPerDay, { userId: oldUser.id, isGuest: false }, fp("10.0.0.9"));
    const d = await checkQuota(asUser(otherUser), "generate", fp("10.0.0.9"));
    expect(d.ok ? "ok" : d.reason).toBe("ip_daily_limit");
    // ...but not from a different network.
    expect((await checkQuota(asUser(otherUser), "generate", fp("10.0.0.10"))).ok).toBe(true);
  });

  it("a second account in the same browser inherits the device's count", async () => {
    // Spread over different IPs so only the device layer can catch it.
    for (let i = 0; i < QUOTAS.generate.perDevicePerDay; i++) {
      await recordUsage("generate", { userId: oldUser.id, isGuest: false }, fp(`10.1.0.${i}`, "device-1"));
    }
    const d = await checkQuota(asUser(otherUser), "generate", fp("10.2.0.1", "device-1"));
    expect(d.ok ? "ok" : d.reason).toBe("device_daily_limit");
  });

  it("a guest identity gets one generation, and a brand-new visitor is still bound by the site-wide guest cap", async () => {
    await recordUsage("generate", { userId: guestId, isGuest: true }, fp("10.3.0.1"));
    const again = await checkQuota({ kind: "guest", userId: guestId, email: null, isAdmin: false }, "generate", fp("10.3.0.2"));
    expect(again.ok ? "ok" : again.reason).toBe("guest_limit");

    for (let i = 1; i < QUOTAS.generate.siteGuestPerDay; i++) {
      await recordUsage("generate", { userId: `g-${i}`, isGuest: true }, fp(`10.4.0.${i}`));
    }
    const newcomer = await checkQuota(null, "generate", fp("10.5.0.1"));
    expect(newcomer.ok ? "ok" : newcomer.reason).toBe("site_daily_limit");
  });

  it("admins are never limited", async () => {
    await seed("generate", 50, { userId: oldUser.id, isGuest: false }, fp("10.6.0.1"));
    const admin: Actor = { kind: "user", userId: "admin", email: "a@x", isAdmin: true };
    expect((await checkQuota(admin, "generate", fp("10.6.0.1"))).ok).toBe(true);
  });

  it("a disabled account is refused", async () => {
    await prisma.user.update({ where: { id: otherUser.id }, data: { disabledAt: new Date() } });
    const d = await checkQuota(asUser(otherUser), "generate", fp("10.7.0.1"));
    expect(d.ok ? "ok" : d.reason).toBe("disabled");
    await prisma.user.update({ where: { id: otherUser.id }, data: { disabledAt: null } });
  });
});

describe("paid edits through a real route (MOCK_AI fixture, no paid calls)", () => {
  const dayId = `quota-day-${stamp}`;
  let itineraryId = "";

  beforeAll(async () => {
    const it = await prisma.itinerary.create({
      data: { userId: oldUser.id, title: "Quota trip", config: j({}), days: j([{ id: dayId, day: 1, city: "Test City", stops: [] }]) },
    });
    itineraryId = it.id;
  });

  const call = () =>
    regenerateAccommodation(
      new Request("http://test/api", {
        method: "POST",
        headers: { "x-forwarded-for": "10.9.0.1", cookie: "device_id=dev-quota" },
        body: JSON.stringify({ itineraryId }),
      }),
      { params: Promise.resolve({ dayId }) },
    );

  it("records each paid edit, and answers 429 with a Chinese message once the daily cap is reached", async () => {
    signInAs(oldUser);
    expect((await call()).status).toBe(200);
    expect(await prisma.usageEvent.count({ where: { kind: "paid_edit", userId: oldUser.id, itineraryId } })).toBe(1);

    await seed("paid_edit", QUOTAS.paid_edit.userPerDay - 1, { userId: oldUser.id, isGuest: false }, fp("10.9.0.2"), itineraryId);
    signInAs(oldUser);
    const blocked = await call();
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe("quota_exceeded");
    expect(body.error).toMatch(/AI 編輯/);
    // A refused edit isn't recorded.
    expect(await prisma.usageEvent.count({ where: { kind: "paid_edit", userId: oldUser.id } })).toBe(QUOTAS.paid_edit.userPerDay);
  });
});

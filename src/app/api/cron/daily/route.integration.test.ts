import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma, j } from "@/lib/db";
import { GET } from "./route";

// Story: once deployed, Vercel Cron calls this route every day to drop
// expired guest trips and Google coordinates past 30 days. Only Vercel,
// holding CRON_SECRET, may trigger it (#211).

const SECRET = "integration-cron-secret";
const call = (authorization?: string) =>
  GET(new Request("http://test/api/cron/daily", authorization ? { headers: { authorization } } : undefined));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/daily", () => {
  it("refuses to run without a CRON_SECRET configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  });

  it("refuses a caller without the secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
  });

  it("deletes expired guest trips and old coordinates for Vercel", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const guest = await prisma.user.create({ data: { isGuest: true } });
    const expired = await prisma.itinerary.create({
      data: { userId: guest.id, title: "t", days: j([]), config: j({}), expiresAt: new Date(Date.now() - 1000) },
    });
    const placeId = `ChIJ-cron-${Date.now()}`;
    await prisma.place.create({
      data: { id: placeId, lat: 1, lng: 2, coordsFetchedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    const res = await call(`Bearer ${SECRET}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expiredGuests.itineraries).toBeGreaterThanOrEqual(1);
    expect(body.expiredCoords.places).toBeGreaterThanOrEqual(1);
    expect(await prisma.itinerary.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.place.findUnique({ where: { id: placeId } })).toMatchObject({ lat: null, lng: null });
  });
});

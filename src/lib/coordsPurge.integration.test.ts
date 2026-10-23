import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, j } from "@/lib/db";
import { purgeExpiredCoords } from "@/lib/coordsPurge";
import { COORDS_MAX_AGE_MS } from "@/lib/placeStorage";

// Story: a trip planned in September is still in the database in November.
// Its coordinates are Google's and may be kept 30 days (ADR-0006): the purge
// removes them everywhere they were copied, leaving the place IDs, and
// leaves this week's coordinates and an airport's (ours) alone.

// The purge runs as the script does: a plain client, outside db.ts.
const plain = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const old = new Date(now.getTime() - COORDS_MAX_AGE_MS - DAY).toISOString();
const recent = new Date(now.getTime() - DAY).toISOString();

let userId: string;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `coords-purge-${Date.now()}@test.local` } });
  userId = user.id;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await plain.$disconnect();
});

async function rawJson(sql: Promise<{ value: string }[]>) {
  const rows = await sql;
  return JSON.parse(rows[0].value);
}

describe("purgeExpiredCoords", () => {
  it("removes expired coordinates from an itinerary, the trash, candidate history and the Place table", async () => {
    const oldStop = { id: "s-old", placeId: "ChIJ-old", lat: 1, lng: 2, coordsFetchedAt: old, description: "九月的景點。" };
    const recentStop = { id: "s-new", placeId: "ChIJ-new", lat: 3, lng: 4, coordsFetchedAt: recent };
    const airport = { id: "s-air", name: "成田機場", lat: 35.77, lng: 140.39 };
    const day = { id: "d1", day: 1, stops: [oldStop, recentStop, airport], accommodation: { ...oldStop, id: "h1" } };
    const itinerary = await prisma.itinerary.create({ data: { userId, title: "t", days: j([day]), config: j({}) } });
    const stamp = new Date("2026-09-15T00:00:00.000Z");
    await plain.itinerary.update({ where: { id: itinerary.id }, data: { updatedAt: stamp } });
    const trashed = await prisma.deletedStop.create({
      data: { itineraryId: itinerary.id, dayId: "d1", dayNumber: 1, originalIndex: 0, stop: j(oldStop) },
    });
    const log = await prisma.stopCandidateLog.create({
      data: { itineraryId: itinerary.id, dayId: "d1", stopId: "s-old", candidates: j([oldStop, recentStop]) },
    });
    const placeId = `ChIJ-purge-${Date.now()}`;
    await prisma.place.create({ data: { id: placeId, lat: 1, lng: 2, coordsFetchedAt: new Date(old) } });

    const result = await purgeExpiredCoords(plain, now);

    expect(result.itineraries).toBeGreaterThanOrEqual(1);
    const [stored] = await rawJson(plain.$queryRaw`SELECT days AS value FROM "Itinerary" WHERE id = ${itinerary.id}`);
    expect(stored.stops[0]).toEqual({ id: "s-old", placeId: "ChIJ-old", description: "九月的景點。" });
    expect(stored.stops[1]).toMatchObject({ lat: 3, lng: 4, coordsFetchedAt: recent });
    expect(stored.stops[2]).toMatchObject({ name: "成田機場", lat: 35.77 });
    expect(stored.accommodation).not.toHaveProperty("lat");
    // Not an edit: the trip's last-saved time stays.
    expect((await plain.itinerary.findUnique({ where: { id: itinerary.id } }))?.updatedAt).toEqual(stamp);

    expect(await rawJson(plain.$queryRaw`SELECT stop AS value FROM "DeletedStop" WHERE id = ${trashed.id}`)).not.toHaveProperty("lat");
    const candidates = await rawJson(plain.$queryRaw`SELECT candidates AS value FROM "StopCandidateLog" WHERE id = ${log.id}`);
    expect(candidates[0]).not.toHaveProperty("lat");
    expect(candidates[1]).toHaveProperty("lat", 3);
    expect(await plain.place.findUnique({ where: { id: placeId } })).toMatchObject({ lat: null, lng: null, coordsFetchedAt: null });
  });

  it("keeps coordinates a write just stamped, and the next purge a month later removes them", async () => {
    const day = { id: "d1", day: 1, stops: [{ id: "s1", placeId: "ChIJ-fresh", lat: 5, lng: 6 }] };
    const { id } = await prisma.itinerary.create({ data: { userId, title: "t", days: j([day]), config: j({}) } });

    await purgeExpiredCoords(plain, now);
    const [kept] = await rawJson(plain.$queryRaw`SELECT days AS value FROM "Itinerary" WHERE id = ${id}`);
    expect(kept.stops[0]).toMatchObject({ lat: 5, lng: 6 });

    await purgeExpiredCoords(plain, new Date(now.getTime() + COORDS_MAX_AGE_MS + DAY));
    const [purged] = await rawJson(plain.$queryRaw`SELECT days AS value FROM "Itinerary" WHERE id = ${id}`);
    expect(purged.stops[0]).toEqual({ id: "s1", placeId: "ChIJ-fresh" });
  });
});

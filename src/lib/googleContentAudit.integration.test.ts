import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { auditGoogleContent, cleanupGoogleContent } from "@/lib/googleContentAudit";
import { COORDS_MAX_AGE_MS } from "@/lib/placeStorage";

// Story: a database from before writes were stripped holds itineraries,
// trash and candidate history with Google names and ratings, and untimed
// coordinates. The cleanup leaves the place IDs and our own text,
// and the audit then finds nothing (ADR-0004, ADR-0006).

// Old rows are written with a plain client: db.ts would strip them.
const plain = new PrismaClient();
const now = new Date();
const recent = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
const tag = Date.now();

let userId: string;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `audit-${tag}@test.local` } });
  userId = user.id;
});

afterAll(async () => {
  await plain.$disconnect();
});

describe("cleanupGoogleContent", () => {
  it("removes what the audit finds, keeps place IDs and our text, and leaves the audit at 0", async () => {
    const oldStop = { id: "s1", name: "淺草寺", placeId: "ChIJ-old", lat: 1, lng: 2, rating: 4.5, address: "Asakusa", description: "寺廟。" };
    const freshStop = { id: "s2", placeId: "ChIJ-fresh", lat: 3, lng: 4, coordsFetchedAt: recent, photoName: "places/x/photos/y" };
    const itinerary = await plain.itinerary.create({
      data: { userId, title: "t", days: JSON.stringify([{ id: "d1", day: 1, stops: [oldStop, freshStop] }]), config: "{}" },
    });
    await plain.deletedStop.create({ data: { itineraryId: itinerary.id, dayId: "d1", dayNumber: 1, originalIndex: 0, stop: JSON.stringify(oldStop) } });
    await plain.mealCandidateLog.create({
      data: { itineraryId: itinerary.id, dayId: "d1", mealType: "lunch", candidates: JSON.stringify([{ ...oldStop, priceLevel: 2 }]) },
    });

    const before = await auditGoogleContent(plain, now);
    expect(before.itineraries.googleFields).toBeGreaterThanOrEqual(1);
    expect(before.candidateLogs.googleFields).toBeGreaterThanOrEqual(1);

    await cleanupGoogleContent(plain, now);

    expect((await auditGoogleContent(plain, now)).total).toBe(0);
    const [day] = JSON.parse((await plain.itinerary.findUniqueOrThrow({ where: { id: itinerary.id } })).days);
    expect(day.stops[0]).toEqual({ id: "s1", placeId: "ChIJ-old", description: "寺廟。" }); // untimed coordinates went too
    expect(day.stops[1]).toEqual({ id: "s2", placeId: "ChIJ-fresh", lat: 3, lng: 4, coordsFetchedAt: recent });
  });

  it("changes nothing when run again", async () => {
    await cleanupGoogleContent(plain, now);
    const again = await cleanupGoogleContent(plain, now);
    expect(again).toEqual({ itineraries: 0, deletedStops: 0, deletedDays: 0, candidateLogs: 0 });
  });

  it("treats coordinates past 30 days as a violation", async () => {
    const later = new Date(now.getTime() + COORDS_MAX_AGE_MS + 1000);
    const report = await auditGoogleContent(plain, later);
    expect(report.itineraries.expiredCoords + report.placeExpiredCoords).toBeGreaterThan(0);
  });
});

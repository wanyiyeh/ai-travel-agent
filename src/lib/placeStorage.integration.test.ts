import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, j } from "@/lib/db";

// Story: whatever route writes an itinerary, a trashed stop or day, or a
// batch of candidates, the Google content in it (name, address, rating,
// photo) never reaches the database — only the place ID, coordinates and our
// own text do (ADR-0004). Checked at the database, through the same Prisma
// client the routes use, for both ways routes pass JSON: as an object and
// pre-stringified with j().

const googleStop = {
  id: "stop-1",
  name: "淺草寺",
  description: "東京最古老的寺廟。",
  duration_minutes: 90,
  placeId: "ChIJ-sensoji",
  lat: 35.7148,
  lng: 139.7967,
  address: "2 Chome-3-1 Asakusa",
  rating: 4.5,
  photoName: "places/ChIJ-sensoji/photos/abc",
};
const day = { id: "day-1", day: 1, waypointCity: "東京", stops: [googleStop] };

const GOOGLE_FIELDS = ["淺草寺", "Asakusa", "4.5", "photos/abc"];
const leaks = (raw: string) => GOOGLE_FIELDS.filter((value) => raw.includes(value));

async function rawDays(id: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ days: string }[]>`SELECT days FROM "Itinerary" WHERE id = ${id}`;
  return rows[0].days;
}

let userId: string;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `place-storage-${Date.now()}@test.local` } });
  userId = user.id;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("every write", () => {
  it.each([
    ["an object", [day]],
    ["a j() string", j([day])],
  ])("an itinerary created with days as %s keeps no Google content", async (_label, days) => {
    const created = await prisma.itinerary.create({ data: { userId, title: "t", days: days as string, config: j({}) } });

    expect(leaks(await rawDays(created.id))).toEqual([]);
    expect(created.days[0].stops[0]).toMatchObject({ placeId: "ChIJ-sensoji", lat: 35.7148, description: "東京最古老的寺廟。" });
  });

  it("an update, and the trash and candidate history written in one transaction, keep none either", async () => {
    const { id } = await prisma.itinerary.create({ data: { userId, title: "t", days: j([]), config: j({}) } });

    await prisma.$transaction([
      prisma.itinerary.update({ where: { id }, data: { days: j([day]) } }),
      prisma.deletedStop.create({ data: { itineraryId: id, dayId: "day-1", dayNumber: 1, originalIndex: 0, stop: j(googleStop) } }),
      prisma.deletedDay.createMany({ data: [{ itineraryId: id, originalIndex: 0, day: j(day) }] }),
      prisma.stopCandidateLog.create({ data: { itineraryId: id, dayId: "day-1", stopId: "stop-1", candidates: j([googleStop]) } }),
    ]);

    expect(leaks(await rawDays(id))).toEqual([]);
    const trashedStop = await prisma.deletedStop.findFirstOrThrow({ where: { itineraryId: id } });
    const trashedDay = await prisma.deletedDay.findFirstOrThrow({ where: { itineraryId: id } });
    const log = await prisma.stopCandidateLog.findFirstOrThrow({ where: { itineraryId: id } });
    expect(leaks(trashedStop.stop)).toEqual([]);
    expect(leaks(trashedDay.day)).toEqual([]);
    expect(leaks(log.candidates)).toEqual([]);
    expect(JSON.parse(log.candidates)[0]).toMatchObject({ placeId: "ChIJ-sensoji" });
  });
});

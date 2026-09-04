import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, j } from "@/lib/db";
import { MOCK_FIXTURES } from "@/lib/mockAi";
import { POST as regenerate } from "./regenerate/route";
import { POST as select } from "./select/route";

// Story: user asks for new accommodation options for a day, then picks one —
// covers /regenerate and /select against a real (test) SQLite db, and checks
// the itinerary row actually persists the pick (not just a 200 response).
describe("accommodation regenerate -> select flow", () => {
  const dayId = "day-1";
  let itineraryId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `accommodation-flow-${Date.now()}@test.local` },
    });

    const itinerary = await prisma.itinerary.create({
      data: {
        userId: user.id,
        title: "Integration Test Trip",
        days: j([
          { id: dayId, day: 1, city: "Test City", stops: [], accommodation: undefined },
        ]),
        config: j({}),
      },
    });

    itineraryId = itinerary.id;
  });

  afterAll(async () => {
    await prisma.itinerary.delete({ where: { id: itineraryId } });
    await prisma.user.deleteMany({ where: { itineraries: { none: {} } } });
    // select() upserts the picked candidate into the shared Place cache —
    // clean it up too so repeat runs don't leave stray cache rows behind.
    await prisma.placeQuery.deleteMany({ where: { placeId: { startsWith: "mock-hotel-" } } });
    await prisma.place.deleteMany({ where: { id: { startsWith: "mock-hotel-" } } });
  });

  it("regenerate returns the MOCK_AI fixture candidates", async () => {
    const res = await regenerate(
      new Request("http://test/api", {
        method: "POST",
        body: JSON.stringify({ itineraryId }),
      }),
      { params: Promise.resolve({ dayId }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates).toEqual(MOCK_FIXTURES.accommodationCandidates);
  });

  it("select persists the chosen candidate onto the itinerary's day", async () => {
    const chosen = MOCK_FIXTURES.accommodationCandidates[1]; // "Mock Hotel Riverside"

    const res = await select(
      new Request("http://test/api", {
        method: "POST",
        body: JSON.stringify({ itineraryId, accommodation: chosen }),
      }),
      { params: Promise.resolve({ dayId }) }
    );

    expect(res.status).toBe(200);

    const stored = await prisma.itinerary.findUniqueOrThrow({ where: { id: itineraryId } });
    const days = stored.days as Array<{ id: string; accommodation?: { placeId?: string; name?: string } }>;
    const day = days.find((d) => d.id === dayId);

    expect(day?.accommodation?.placeId).toBe(chosen.placeId);
    expect(day?.accommodation?.name).toBe(chosen.name);

    // select() also caches the picked place for reuse elsewhere in the app.
    const cachedPlace = await prisma.place.findUnique({ where: { id: chosen.placeId } });
    expect(cachedPlace?.name).toBe(chosen.name);
  });
});

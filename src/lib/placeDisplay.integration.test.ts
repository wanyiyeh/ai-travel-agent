import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, j } from "@/lib/db";
import { signInAs } from "@tests/setup/mockAuth";
import { authorizeItinerary } from "@/lib/auth/ownership";
import { mockGoogleResponse } from "@/lib/mockPlaces";
import * as itineraryRoute from "@/app/api/v1/itinerary/[id]/route";

// Story: with compliant storage on, an itinerary is saved with place IDs only
// (ADR-0004). Opening it still shows every place's name and address, fetched
// back from Google for the days the page asks for, and a route working on
// one day gets that day's names back too. Each fetch is metered.

const stamp = Date.now();
const owner = { id: `pd-owner-${stamp}`, email: `pd-owner-${stamp}@example.com` };
const itineraryId = `pd-trip-${stamp}`;

// A place as Text Search found it, so its (mock) id carries its name.
async function found(name: string): Promise<string> {
  const res = mockGoogleResponse("https://places.googleapis.com/v1/places:searchText", { body: JSON.stringify({ textQuery: name }) });
  return ((await res.json()) as { places: { id: string }[] }).places[0].id;
}

function fakeGoogle() {
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "integration-fake-key");
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      return mockGoogleResponse(url, init);
    }),
  );
  return calls;
}

const get = (query = "") =>
  itineraryRoute.GET(new Request(`http://test/api/v1/itinerary/${itineraryId}${query}`), {
    params: Promise.resolve({ id: itineraryId }),
  });

type Stop = { name?: string; address?: string };
const stopsOf = (body: { data: { days: { stops: Stop[] }[] } }, day: number) => body.data.days[day - 1].stops;

beforeAll(async () => {
  vi.stubEnv("COMPLIANT_PLACE_STORAGE", "1");
  await prisma.user.create({ data: owner });
  await prisma.itinerary.create({
    data: {
      id: itineraryId,
      userId: owner.id,
      title: "東京",
      config: j({}),
      days: j([
        { id: `pd-day1-${stamp}`, day: 1, stops: [{ id: "s1", name: "淺草寺", placeId: await found("淺草寺"), lat: 1, lng: 1 }] },
        { id: `pd-day2-${stamp}`, day: 2, stops: [{ id: "s2", name: "東京晴空塔", placeId: await found("東京晴空塔"), lat: 1, lng: 1 }] },
      ]),
    },
  });
  vi.unstubAllEnvs();
});

// The test session is signed out after each test (tests/setup/mockAuth.ts).
beforeEach(() => {
  signInAs(owner);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("place names on a stored-without-names itinerary", () => {
  it("was saved without them", async () => {
    const rows = await prisma.$queryRaw<{ days: string }[]>`SELECT days FROM Itinerary WHERE id = ${itineraryId}`;
    expect(rows[0].days).not.toContain("淺草寺");
  });

  it("GET fills every day by default, and meters the lookups", async () => {
    fakeGoogle();
    const startedAt = new Date();
    const body = await (await get()).json();

    expect(stopsOf(body, 1)[0]).toMatchObject({ name: "淺草寺", address: "Mock address — 淺草寺" });
    expect(stopsOf(body, 2)[0]).toMatchObject({ name: "東京晴空塔" });
    const measured = await prisma.usageMeasurement.findFirst({ where: { label: "hydrate", createdAt: { gte: startedAt } } });
    expect(measured?.googleTotal).toBe(2);
  });

  it("GET ?days=2 fills only the day asked for", async () => {
    const calls = fakeGoogle();
    const body = await (await get("?days=2")).json();

    expect(stopsOf(body, 1)[0]).not.toHaveProperty("name");
    expect(stopsOf(body, 2)[0]).toMatchObject({ name: "東京晴空塔" });
    expect(calls).toHaveLength(1);
  });

  it("a route working on one day gets that day's names through authorizeItinerary", async () => {
    fakeGoogle();
    const access = await authorizeItinerary(itineraryId, { dayIds: [`pd-day1-${stamp}`] });

    expect(access.ok).toBe(true);
    if (!access.ok) return;
    const days = access.itinerary.days as { stops: Stop[] }[];
    expect(days[0].stops[0].name).toBe("淺草寺");
    expect(days[1].stops[0]).not.toHaveProperty("name");
  });

  it("asks Google for nothing when a route doesn't ask for names", async () => {
    const calls = fakeGoogle();
    await authorizeItinerary(itineraryId);
    expect(calls).toEqual([]);
  });
});

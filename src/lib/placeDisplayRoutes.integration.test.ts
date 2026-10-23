import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, j } from "@/lib/db";
import { signInAs } from "@tests/setup/mockAuth";
import { mockGoogleResponse } from "@/lib/mockPlaces";
import * as trashRoute from "@/app/api/v1/itinerary/[id]/trash/route";
import * as restoreStopRoute from "@/app/api/v1/itinerary/[id]/trash/[deletedStopId]/restore/route";
import * as stopHistoryRoute from "@/app/api/v1/days/[dayId]/stops/[stopId]/candidates-history/route";
import * as accommodationEnrichRoute from "@/app/api/v1/days/[dayId]/accommodation/enrich/route";
import * as stopEnrichRoute from "@/app/api/v1/stops/[stopId]/enrich/route";

// Story: with compliant storage on, the trash, the candidate history and an
// already-found stop or hotel are kept with place IDs only (ADR-0004). Every
// screen that shows them still gets each place's name back from Google —
// none of them hands the page a nameless place.

const stamp = Date.now();
const owner = { id: `pdr-owner-${stamp}`, email: `pdr-owner-${stamp}@example.com` };
const itineraryId = `pdr-trip-${stamp}`;
const dayId = `pdr-day-${stamp}`;
const stopId = `pdr-stop-${stamp}`;
let deletedStopId: string;

async function found(name: string): Promise<string> {
  const res = mockGoogleResponse("https://places.googleapis.com/v1/places:searchText", { body: JSON.stringify({ textQuery: name }) });
  return ((await res.json()) as { places: { id: string }[] }).places[0].id;
}

const post = (body: unknown) => new Request("http://test", { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  const sensoji = await found("淺草寺");
  await prisma.user.create({ data: owner });
  await prisma.itinerary.create({
    data: {
      id: itineraryId,
      userId: owner.id,
      title: "東京",
      config: j({}),
      days: j([
        {
          id: dayId,
          day: 1,
          stops: [{ id: stopId, name: "淺草寺", placeId: sensoji, lat: 35.71, lng: 139.79 }],
          accommodation: { name: "新宿格拉斯麗飯店", area: "新宿", placeId: await found("新宿格拉斯麗飯店"), lat: 35.69, lng: 139.7 },
        },
      ]),
    },
  });
  const trashed = await prisma.deletedStop.create({
    data: { itineraryId, dayId, dayNumber: 1, originalIndex: 1, stop: j({ id: "gone", name: "東京晴空塔", placeId: await found("東京晴空塔") }) },
  });
  deletedStopId = trashed.id;
  await prisma.stopCandidateLog.create({
    data: { itineraryId, dayId, stopId, candidates: j([{ name: "上野公園", placeId: await found("上野公園"), description: "", duration_minutes: 60 }]) },
  });
  vi.unstubAllEnvs();
});

beforeEach(() => {
  signInAs(owner); // signed out after each test (tests/setup/mockAuth.ts)
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "integration-fake-key");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => mockGoogleResponse(url, init)));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("screens that show stored places get their names back", () => {
  it("the trash", async () => {
    const res = await trashRoute.GET(new Request("http://test"), { params: Promise.resolve({ id: itineraryId }) });
    const { entries } = await res.json();
    expect(entries[0].stop.name).toBe("東京晴空塔");
  });

  it("a stop restored from the trash", async () => {
    const res = await restoreStopRoute.POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ id: itineraryId, deletedStopId }),
    });
    const body = await res.json();
    expect(body.stop.name).toBe("東京晴空塔");
  });

  it("the candidate history", async () => {
    const res = await stopHistoryRoute.GET(new Request(`http://test?itineraryId=${itineraryId}`), {
      params: Promise.resolve({ dayId, stopId }),
    });
    const { history } = await res.json();
    expect(history[0].candidates[0].name).toBe("上野公園");
  });

  it("a hotel that was already found", async () => {
    const res = await accommodationEnrichRoute.POST(post({ itineraryId }), { params: Promise.resolve({ dayId }) });
    const { accommodation } = await res.json();
    expect(accommodation.name).toBe("新宿格拉斯麗飯店");
  });

  it("a stop that was already found keeps its address on the map", async () => {
    const res = await stopEnrichRoute.POST(post({ itineraryId }), { params: Promise.resolve({ stopId }) });
    const body = await res.json();
    expect(body.address).toBe("Mock address — 淺草寺");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { NEUTRAL_PREFERENCE_INTENT, type PreferenceIntent } from "@/lib/schemas";

// Does the pace choice change how many attractions a sightseeing day gets?
// The home-page form promises 悠閒 ≤3 / 適中 3-4 / 緊湊 5+ per day (PACE_OPTIONS
// in src/app/page.tsx). Google, distances and the copy LLM are all mocked;
// only the real scheduler modules run. `it.fails` = known gap, see
// assembleItineraryDays.test.ts.

const createMock = vi.fn();
const nearbyMock = vi.fn();

vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
}));
vi.mock("@/lib/placesTextSearch", () => ({
  getCityCenter: async () => ({ lat: 35.68, lng: 139.76 }),
}));
vi.mock("@/lib/fetchCityRestaurants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fetchCityRestaurants")>()),
  fetchNearbyPlaceCandidates: (...args: unknown[]) => nearbyMock(...args),
}));
vi.mock("@/lib/skeletonCopy", () => ({
  generateSkeletonCopy: async () => ({ stops: {} }),
}));
// Full replacement rather than importOriginal: the real module pulls in
// @/lib/db. Its geo re-exports come straight from the db-free @/lib/geo.
vi.mock("@/lib/distanceMatrix", async () => ({
  ...(await import("@/lib/geo")),
  getDistancesForStopPairs: async (stops: unknown[]) => stops.slice(1).map(() => null),
  pickModeForDistance: () => "walking",
  describeTransport: () => "",
}));

const { generateDayStops } = await import("./itineraryCityGen");

// A pool big enough that pool size is never what limits a day's stop count.
const POOL: PlaceCandidate[] = Array.from({ length: 20 }, (_, i) => ({
  name: `Spot ${i}`,
  placeId: `pid-${i}`,
  lat: 35.68 + i * 0.002,
  lng: 139.76 + i * 0.002,
  address: "addr",
  rating: 4.5,
  priceLevel: null,
  types: ["tourist_attraction", i % 2 ? "museum" : "park"],
}));

async function stopsPerDay(pace: PreferenceIntent["pace"]): Promise<number[]> {
  const days = await generateDayStops("東京", 2, "JPY", [], undefined, { ...NEUTRAL_PREFERENCE_INTENT, pace });
  // Guard: a count from the pure-LLM fallback would say nothing about the scheduler.
  expect(createMock).not.toHaveBeenCalled();
  return days.map((d) => d.length);
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "key");
  createMock.mockReset();
  nearbyMock.mockReset();
  nearbyMock.mockResolvedValue(POOL);
});

describe("generateDayStops — pace vs stops per day", () => {
  it("適中 (moderate) gives 3-4 stops a day", async () => {
    for (const n of await stopsPerDay("moderate")) {
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(4);
    }
  });

  // Gap: STOPS_PER_DAY is a fixed 4 in itineraryCityGen.ts; pace only changes
  // the buffer between stops (assignTimeSlots), never how many are picked.
  it.fails("悠閒 (relaxed) gives at most 3 stops a day", async () => {
    for (const n of await stopsPerDay("relaxed")) expect(n).toBeLessThanOrEqual(3);
  });

  it.fails("緊湊 (intensive) gives at least 5 stops a day", async () => {
    for (const n of await stopsPerDay("intensive")) expect(n).toBeGreaterThanOrEqual(5);
  });
});

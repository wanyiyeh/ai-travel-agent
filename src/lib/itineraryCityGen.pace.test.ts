import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { NEUTRAL_PREFERENCE_INTENT, type PreferenceIntent } from "@/lib/schemas";

// Does the pace choice change how many attractions a sightseeing day gets?
// Pace is defined by how long each stop lasts (plan/form-preference-wiring.md
// 1.2), and the stop count follows from what fits before 18:00: roughly
// 緊湊 5-6 / 適中 2-3 / 悠閒 about 2 on a museum/park pool. Google, distances
// and the copy LLM are all mocked; only the real scheduler modules run.

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
  it("緊湊 (intensive) gives at least 5 stops a day", async () => {
    for (const n of await stopsPerDay("intensive")) expect(n).toBeGreaterThanOrEqual(5);
  });

  it("適中 (moderate) gives 2-3 stops a day", async () => {
    for (const n of await stopsPerDay("moderate")) {
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
    }
  });

  it("悠閒 (relaxed) gives at most 2 stops a day", async () => {
    for (const n of await stopsPerDay("relaxed")) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(2);
    }
  });
});

describe("generateDayStops — 出門時間 (start time)", () => {
  async function stopsWithStart(startTimePreference: PreferenceIntent["startTimePreference"]): Promise<number[]> {
    const days = await generateDayStops("東京", 2, "JPY", [], undefined, {
      ...NEUTRAL_PREFERENCE_INTENT,
      pace: "intensive",
      startTimePreference,
    });
    return days.map((d) => d.length);
  }

  it("a late start (11:00) leaves room for fewer stops than an early one (07:30)", async () => {
    const early = await stopsWithStart("early");
    const late = await stopsWithStart("late");
    for (let i = 0; i < early.length; i++) expect(late[i]).toBeLessThan(early[i]);
  });
});

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

const { generateDayStops, generateDepartureDayStops } = await import("./itineraryCityGen");

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

describe("stop identity and reuse", () => {
  it("gives every stop its own id, separate from the place it visits", async () => {
    const days = await generateDayStops("東京", 2, "JPY", [], undefined, NEUTRAL_PREFERENCE_INTENT);
    const stops = days.flat();
    expect(new Set(stops.map((s) => s.id)).size).toBe(stops.length);
    for (const s of stops) expect(s.id).not.toBe(s.placeId);
  });

  it("the return day still finds stops when the most popular places were used earlier", async () => {
    // Like the real cache: the pool is sliced to maxCount before anything else.
    nearbyMock.mockImplementation(async (_c: unknown, _k: unknown, _t: unknown, _r: unknown, maxCount: number) =>
      POOL.slice(0, maxCount)
    );
    const usedEarlier = POOL.slice(0, 10).map((p) => p.placeId);

    const stops = await generateDepartureDayStops("東京", "JPY", undefined, undefined, NEUTRAL_PREFERENCE_INTENT, usedEarlier);

    expect(stops.length).toBeGreaterThan(0);
    for (const s of stops) expect(usedEarlier).not.toContain(s.placeId);
  });
});

describe("long stays — supplemental attraction search", () => {
  const place = (id: string, type: string): PlaceCandidate => ({
    name: id,
    placeId: id,
    lat: 35.68 + Number(id.replace(/\D/g, "")) * 0.002,
    lng: 139.76,
    address: "addr",
    rating: 4.5,
    priceLevel: null,
    types: ["tourist_attraction", type],
  });
  const main = Array.from({ length: 6 }, (_, i) => place(`main${i}`, "park"));
  const extra = Array.from({ length: 10 }, (_, i) => place(`extra${i}`, "museum"));
  const byTypes = async (_c: unknown, _k: unknown, types: string[]) => (types.includes("tourist_attraction") ? main : extra);

  it("adds other kinds of places once the main pool can't cover the stay", async () => {
    nearbyMock.mockImplementation(byTypes);

    const days = await generateDayStops("東京", 5, "JPY", [], undefined, NEUTRAL_PREFERENCE_INTENT);

    expect(nearbyMock.mock.calls.some((c) => (c[2] as string[]).includes("museum"))).toBe(true);
    expect(days.flat().some((s) => String(s.placeId).startsWith("extra"))).toBe(true);
  });

  it("doesn't pay for the extra search when the main pool is enough", async () => {
    nearbyMock.mockImplementation(byTypes);

    await generateDayStops("東京", 1, "JPY", [], undefined, NEUTRAL_PREFERENCE_INTENT);

    expect(nearbyMock).toHaveBeenCalledTimes(1);
  });

  it("never brings back a place the trip already used", async () => {
    nearbyMock.mockImplementation(byTypes);
    const used = ["extra0", "extra1"];

    const days = await generateDayStops("東京", 5, "JPY", [...used], undefined, NEUTRAL_PREFERENCE_INTENT);

    for (const s of days.flat()) expect(used).not.toContain(s.placeId);
  });
});

// Story: a culture trip's day 3 was 太陽城 9:00-12:00, 東京巨蛋 13:00-15:00 and
// 東京國立博物館 15:15-18:15 — the museum ran 15 minutes past 18:00 and was
// dropped, leaving 2 stops.
describe("generateDayStops — the end of the day", () => {
  it("keeps a last stop that ends up to 30 minutes past 18:00", async () => {
    // Mostly 2-hour landmarks, so the day is planned for 3 stops; the two
    // 3-hour museums nearest the center make it run to 18:15.
    const place = (i: number, type: string): PlaceCandidate => ({
      ...POOL[0],
      name: `${type} ${i}`,
      placeId: `${type}-${i}`,
      lat: 35.68 + i * 0.002,
      types: ["tourist_attraction", type],
    });
    nearbyMock.mockResolvedValue([
      place(0, "museum"),
      place(1, "museum"),
      ...Array.from({ length: 18 }, (_, i) => place(i + 2, "historical_landmark")),
    ]);

    const [day] = await generateDayStops("東京", 1, "JPY", [], undefined, NEUTRAL_PREFERENCE_INTENT);

    expect(day.map((s) => s.placeId)).toEqual(expect.arrayContaining(["museum-0", "museum-1"]));
    expect(day).toHaveLength(3);
  });
});

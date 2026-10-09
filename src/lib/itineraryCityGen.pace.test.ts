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
const distancesMock = vi.fn<(stops: unknown[], pickMode: (km: number) => string) => Promise<null[]>>(async (stops) =>
  stops.slice(1).map(() => null)
);

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
  getDistancesForStopPairs: (stops: unknown[], pickMode: (km: number) => string) => distancesMock(stops, pickMode),
  // Honors the walk limit, so tests can see which limit a generator passes.
  pickModeForDistance: (km: number, walkLimitKm = 1.2) => (km < walkLimitKm ? "walking" : "transit"),
  describeTransport: () => "",
}));

const { generateDayStops, generateDepartureDayStops, generateThemedDayStops } = await import("./itineraryCityGen");

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
  distancesMock.mockClear();
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

// Story: staying in Shinjuku, 文化歷史 and no preference used to get the same
// 8 places — a 20-place popular pool near the lodging has few museums.
describe("generateThemedDayStops — themed days", () => {
  const place = (id: string, type: string, i: number): PlaceCandidate => ({
    ...POOL[0],
    name: id,
    placeId: id,
    lat: 35.68 + i * 0.001,
    types: ["tourist_attraction", type],
  });
  const parks = Array.from({ length: 20 }, (_, i) => place(`park${i}`, "park", i));
  const museums = Array.from({ length: 20 }, (_, i) => place(`museum${i}`, "museum", i));
  const byTypes = async (_c: unknown, _k: unknown, types: string[]) => (types.includes("tourist_attraction") ? parks : museums);
  const culture = { ...NEUTRAL_PREFERENCE_INTENT, pace: "intensive" as const, interestBoost: ["culture"] };

  it("searches the theme's own pool and fills most of each day from it", async () => {
    nearbyMock.mockImplementation(byTypes);

    const { stopsByDay, themeByDay } = await generateThemedDayStops("東京", 2, "JPY", [], undefined, culture);

    expect(nearbyMock.mock.calls.some((c) => (c[2] as string[]).includes("art_museum"))).toBe(true);
    expect(themeByDay).toEqual(["culture", "culture"]);
    for (const day of stopsByDay) {
      const onTheme = day.filter((s) => String(s.placeId).startsWith("museum")).length;
      // About a third stays popular: 6 stops -> 4 museums, 2 parks.
      expect(onTheme).toBe(day.length - Math.max(1, Math.floor(day.length / 3)));
    }
  });

  it("doesn't title a day by a theme it got no places for", async () => {
    nearbyMock.mockImplementation(async (_c: unknown, _k: unknown, types: string[]) =>
      types.includes("tourist_attraction") ? parks : []
    );

    const { themeByDay } = await generateThemedDayStops("東京", 1, "JPY", [], undefined, culture);

    expect(themeByDay).toEqual([undefined]);
  });

  // Story: the culture eval trip got 2 stops a day (baseline 2.7). Its
  // culture pool was mostly 3-hour museums, which cut the estimate, but the
  // places picked near the lodging were short sights and days ended by 15:00.
  it("doesn't let a theme pool of long museums shrink the day", async () => {
    const near = [place("monument0", "monument", 1), place("monument1", "monument", 2)];
    const farMuseums = Array.from({ length: 18 }, (_, i) => ({ ...place(`museum${i}`, "museum", i), lat: 35.75 }));
    nearbyMock.mockImplementation(async (_c: unknown, _k: unknown, types: string[]) =>
      types.includes("tourist_attraction") ? parks : [...near, ...farMuseums]
    );

    const moderateCulture = { ...NEUTRAL_PREFERENCE_INTENT, pace: "moderate" as const, interestBoost: ["culture"] };
    const { stopsByDay } = await generateThemedDayStops("東京", 1, "JPY", [], undefined, moderateCulture);
    const baseline = await generateDayStops("東京", 1, "JPY", [], undefined, { ...moderateCulture, interestBoost: [] });

    expect(stopsByDay[0]).toHaveLength(baseline[0].length);
  });

  it("makes no theme search without interests", async () => {
    nearbyMock.mockImplementation(byTypes);

    const { themeByDay } = await generateThemedDayStops("東京", 1, "JPY", [], undefined, NEUTRAL_PREFERENCE_INTENT);

    expect(nearbyMock).toHaveBeenCalledTimes(1);
    expect(themeByDay).toEqual([undefined]);
  });
});

describe("generateThemedDayStops — 室內行程為主 (indoor first)", () => {
  const place = (id: string, type: string, i: number): PlaceCandidate => ({
    ...POOL[0],
    name: id,
    placeId: id,
    lat: 35.68 + i * 0.001,
    types: ["tourist_attraction", type],
  });
  // Parks first, so by popularity they'd be picked first.
  const mixed = [
    ...Array.from({ length: 10 }, (_, i) => place(`park${i}`, "park", i)),
    ...Array.from({ length: 10 }, (_, i) => place(`museum${i}`, "museum", i + 10)),
  ];
  const indoor = { ...NEUTRAL_PREFERENCE_INTENT, pace: "moderate" as const, indoorFirst: true };
  const outdoorIds = (days: Array<Array<Record<string, unknown>>>) =>
    days.flat().map((s) => String(s.placeId)).filter((id) => id.startsWith("park"));

  it("leaves outdoor places out when there are enough indoor ones", async () => {
    nearbyMock.mockResolvedValue(mixed);

    const { stopsByDay } = await generateThemedDayStops("東京", 2, "JPY", [], undefined, indoor);

    expect(stopsByDay.flat().length).toBeGreaterThan(0);
    expect(outdoorIds(stopsByDay)).toEqual([]);
  });

  it("still schedules outdoor places for a traveler who also chose 自然景觀", async () => {
    nearbyMock.mockResolvedValue(mixed);

    const { stopsByDay } = await generateThemedDayStops("東京", 2, "JPY", [], undefined, { ...indoor, interestBoost: ["nature"] });

    expect(outdoorIds(stopsByDay).length).toBeGreaterThan(0);
  });

  // Story: staying in Shinjuku, places with no telling type (新宿黃金街, the
  // Shibuya crossing) took most slots ahead of museums and observation decks.
  it("prefers places known to be indoor over undecided ones", async () => {
    const undecided = Array.from({ length: 10 }, (_, i) => place(`street${i}`, "city_hall", i));
    const museums = Array.from({ length: 10 }, (_, i) => place(`museum${i}`, "museum", i + 10));
    nearbyMock.mockResolvedValue([...undecided, ...museums]);

    const { stopsByDay } = await generateThemedDayStops("東京", 1, "JPY", [], undefined, indoor);

    const ids = stopsByDay.flat().map((s) => String(s.placeId));
    expect(ids.filter((id) => id.startsWith("museum")).length).toBeGreaterThan(ids.length / 2);
  });

  it("takes transit beyond a 500m walk", async () => {
    nearbyMock.mockResolvedValue(mixed);

    await generateThemedDayStops("東京", 1, "JPY", [], undefined, indoor);

    const pickMode = distancesMock.mock.calls[0][1];
    expect(pickMode(0.8)).toBe("transit");
  });

  it("changes nothing for a traveler who didn't choose it", async () => {
    nearbyMock.mockResolvedValue(mixed);

    const { stopsByDay } = await generateThemedDayStops("東京", 2, "JPY", [], undefined, { ...indoor, indoorFirst: undefined });

    expect(outdoorIds(stopsByDay).length).toBeGreaterThan(0);
    expect(distancesMock.mock.calls[0][1](0.8)).toBe("walking");
  });
});

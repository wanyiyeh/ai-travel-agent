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
  // The real walk/transit/drive rules, so tests see which a generator picks.
  ...(await import("@/lib/travelMode")),
  getDistancesForStopPairs: (stops: unknown[], pickMode: (km: number) => string) => distancesMock(stops, pickMode),
  describeTransport: () => "",
}));

const { generateDayStops, generateDepartureDayStops, generateThemedDayStops, generateTransitDayStops, withoutRevisits } = await import(
  "./itineraryCityGen"
);

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

// Story: 新宿黃金街 kept landing in the morning, on the return day too.
describe("generateThemedDayStops — bar streets", () => {
  it("never schedules a bar street as a daytime sight", async () => {
    const goldenGai: PlaceCandidate = {
      ...POOL[0],
      name: "新宿黃金街",
      placeId: "golden-gai",
      rating: 4.9, // the most popular, so it would be picked first
      types: ["tourist_attraction", "ramen_restaurant", "bar", "japanese_restaurant", "restaurant", "food"],
    };
    nearbyMock.mockResolvedValue([goldenGai, ...POOL]);

    const { stopsByDay } = await generateThemedDayStops("東京", 2, "JPY", [], undefined, NEUTRAL_PREFERENCE_INTENT);

    expect(stopsByDay.flat().length).toBeGreaterThan(0);
    expect(stopsByDay.flat().map((s) => s.placeId)).not.toContain("golden-gai");
  });
});

// 日落和天氣 (dayConditions.ts): heat and rain bend the day like 室內行程為主, without its narrower pool.
describe("generateThemedDayStops — sunset and weather", () => {
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
  const moderate = { ...NEUTRAL_PREFERENCE_INTENT, pace: "moderate" as const };
  const calm = { sunsetMinute: 19 * 60, hot: false, rainy: false, cold: false };
  const run = (conditions: typeof calm) =>
    generateThemedDayStops("東京", 2, "JPY", [], undefined, moderate, undefined, undefined, 0, [], [], [conditions, conditions]);
  const ids = (days: Array<Array<Record<string, unknown>>>) => days.flat().map((s) => String(s.placeId));

  it("scores indoor places up in a rainy month, still with outdoor ones", async () => {
    nearbyMock.mockResolvedValue(mixed);

    const dry = ids((await run(calm)).stopsByDay);
    const wet = ids((await run({ ...calm, rainy: true })).stopsByDay);

    const museums = (list: string[]) => list.filter((id) => id.startsWith("museum")).length;
    expect(museums(wet)).toBeGreaterThan(museums(dry));
  });

  it("keeps outdoor places in a hot month, but off midday", async () => {
    nearbyMock.mockResolvedValue(mixed);

    const { stopsByDay } = await run({ ...calm, hot: true });

    expect(ids(stopsByDay).some((id) => id.startsWith("park"))).toBe(true);
    for (const day of stopsByDay) {
      const middle = day.slice(1, -1).map((s) => String(s.placeId));
      expect(middle.filter((id) => id.startsWith("park"))).toEqual([]);
    }
  });

  it("takes the parks first on a day that gets dark early", async () => {
    nearbyMock.mockResolvedValue(mixed);

    const { stopsByDay } = await run({ ...calm, sunsetMinute: 16 * 60 + 30 });

    for (const day of stopsByDay) {
      const order = day.map((s) => (String(s.placeId).startsWith("park") ? "park" : "indoor"));
      expect(order.indexOf("indoor") === -1 || order.lastIndexOf("park") < order.indexOf("indoor")).toBe(true);
    }
  });
});

// 季節限定 (seasonalHighlights.ts): the highlights go on their day, and only there.
describe("generateThemedDayStops — seasonal day", () => {
  const highlight = (id: string, lat: number): PlaceCandidate => ({ ...POOL[0], name: id, placeId: id, lat, types: ["park"] });
  // Far from the popular pool, so nothing but the reservation would put them on day 2.
  const ginkgo = highlight("ginkgo", 35.74);
  const garden = highlight("garden", 35.741);
  const moderate = { ...NEUTRAL_PREFERENCE_INTENT, pace: "moderate" as const };

  it("puts the highlights on the seasonal day and nowhere else", async () => {
    const { stopsByDay, themeByDay } = await generateThemedDayStops(
      "東京", 3, "JPY", [], undefined, moderate, undefined, undefined, 0, [], [undefined, [ginkgo, garden], undefined]
    );

    const ids = stopsByDay.map((day) => day.map((s) => String(s.placeId)));
    expect(ids[1]).toEqual(expect.arrayContaining(["ginkgo", "garden"]));
    expect([...ids[0], ...ids[2]]).not.toContain("ginkgo");
    expect(themeByDay[1]).toBeUndefined();
  });

  it("keeps them on an indoor-first trip, which the traveler left 季節限定 on for", async () => {
    const museums = Array.from({ length: 20 }, (_, i) => ({ ...POOL[i], types: ["tourist_attraction", "museum"] }));
    nearbyMock.mockResolvedValue(museums);

    const { stopsByDay } = await generateThemedDayStops(
      "東京", 2, "JPY", [], undefined, { ...moderate, indoorFirst: true }, undefined, undefined, 0, [], [undefined, [ginkgo, garden]]
    );

    expect(stopsByDay[1].map((s) => String(s.placeId))).toEqual(expect.arrayContaining(["ginkgo", "garden"]));
  });
});

// 固定行程: the booked time is locked and the day is planned around it.
describe("generateThemedDayStops — fixed events", () => {
  const concertStop = { id: "concert", name: "東京巨蛋", lat: 35.7056, lng: 139.7519, fixedEvent: { type: "concert", startTime: "15:00", endTime: "18:00" } };
  const concert = { block: { startMinute: 15 * 60, endMinute: 18 * 60 }, stop: concertStop };
  const moderate = { ...NEUTRAL_PREFERENCE_INTENT, pace: "moderate" as const };

  it("slots the event in by time, after the stops that fit before it", async () => {
    const { stopsByDay } = await generateThemedDayStops("東京", 1, "JPY", [], undefined, moderate, undefined, undefined, 0, [[concert]]);

    const day = stopsByDay[0];
    expect(day[day.length - 1].id).toBe("concert");
    expect(day.length).toBeGreaterThan(1);
  });

  it("leaves fewer stops on a day with an event than on a free one", async () => {
    const free = await generateThemedDayStops("東京", 1, "JPY", [], undefined, moderate);
    const withConcert = await generateThemedDayStops("東京", 1, "JPY", [], undefined, moderate, undefined, undefined, 0, [[concert]]);

    // Minus the event itself.
    expect(withConcert.stopsByDay[0].length - 1).toBeLessThan(free.stopsByDay[0].length);
  });

  it("works out transport to and from the event in its place in the day", async () => {
    await generateThemedDayStops("東京", 1, "JPY", [], undefined, moderate, undefined, undefined, 0, [[concert]]);

    const points = distancesMock.mock.calls[0][0] as Array<{ id: string }>;
    expect(points[points.length - 1].id).toBe("concert");
  });
});

describe("generateDepartureDayStops — fixed events", () => {
  it("still shows a booked lunch on a return day with no time for anything else", async () => {
    const lunch = { block: { startMinute: 12 * 60, endMinute: 13 * 60 }, stop: { id: "booked", name: "Booked" } };

    // An 11:00 flight leaves no time for stops.
    const stops = await generateDepartureDayStops("東京", "JPY", "11:00", undefined, NEUTRAL_PREFERENCE_INTENT, [], undefined, [lunch]);

    expect(stops.map((s) => s.id)).toEqual(["booked"]);
  });
});

// 2d-2: a show on the day the trip moves to its city.
describe("generateTransitDayStops — fixed events", () => {
  const transitPlan = (arrivalTime: string) =>
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              prepStops: [{ name: "退房", description: "d", duration_minutes: 30, time_of_day: "morning" }],
              transitStop: { name: "搭新幹線", description: "d", duration_minutes: 150, time_of_day: "morning" },
              arrivalTime,
            }),
          },
        },
      ],
    });
  const show = { block: { startMinute: 15 * 60, endMinute: 18 * 60 }, stop: { id: "show", name: "大阪城ホール", lat: 34.6939, lng: 135.5338 } };

  it("plans the arrival stops around the show and puts it in its place", async () => {
    transitPlan("11:00");

    const stops = await generateTransitDayStops("東京", "大阪", "JPY", undefined, NEUTRAL_PREFERENCE_INTENT, [], [show]);

    expect(stops.slice(0, 2).map((s) => s.name)).toEqual(["退房", "搭新幹線"]);
    expect(stops[stops.length - 1].id).toBe("show");
  });

  it("still shows the event when the train arrives too late for anything else", async () => {
    transitPlan("17:30");
    // A 19:00 show, arriving 30 minutes early.
    const evening = { ...show, block: { startMinute: 18 * 60 + 30, endMinute: 21 * 60 + 30 } };

    const stops = await generateTransitDayStops("東京", "大阪", "JPY", undefined, NEUTRAL_PREFERENCE_INTENT, [], [evening]);

    expect(stops.map((s) => s.name)).toEqual(["退房", "搭新幹線", "大阪城ホール"]);
  });
});

// 自駕: the car goes back at the airport after the last day's stops.
describe("generateDepartureDayStops — returning the rental car", () => {
  it("ends with the car return, 30 minutes before the airport buffer", async () => {
    const returnStop = (minute: number) => ({ id: "return", name: "機場還車", startedAt: minute });

    // 17:00 flight: stops end by 13:30, then the car goes back.
    const stops = await generateDepartureDayStops("東京", "JPY", "17:00", undefined, NEUTRAL_PREFERENCE_INTENT, [], undefined, [], returnStop);

    expect(stops[stops.length - 1]).toMatchObject({ id: "return", startedAt: 13 * 60 + 30 });
    expect(stops.length).toBeGreaterThan(1);
  });
});

describe("generateTransitDayStops — 自駕", () => {
  it("tells the transit-day planner the traveler drives between cities", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ prepStops: [], transitStop: { name: "開車前往大阪", description: "d", duration_minutes: 300 }, arrivalTime: "19:00" }) } }],
    });

    await generateTransitDayStops("東京", "大阪", "JPY", undefined, { ...NEUTRAL_PREFERENCE_INTENT, selfDrive: true });

    expect(createMock.mock.calls[0][0].messages[0].content).toContain("【旅客自駕】");
  });

  it("says nothing about driving for public transport", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ prepStops: [], transitStop: { name: "搭新幹線", description: "d", duration_minutes: 150 }, arrivalTime: "19:00" }) } }],
    });

    await generateTransitDayStops("東京", "大阪", "JPY", undefined, NEUTRAL_PREFERENCE_INTENT);

    expect(createMock.mock.calls[0][0].messages[0].content).not.toContain("【旅客自駕】");
  });
});

// Story: leaving 小樽 after two days there, the morning went back to 小樽運河.
describe("generateTransitDayStops — places already visited", () => {
  const plan = (prepStops: { name: string }[]) =>
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              prepStops: prepStops.map((s) => ({ ...s, description: "d", duration_minutes: 30, time_of_day: "morning" })),
              transitStop: { name: "搭乘JR快速列車前往札幌", description: "d", duration_minutes: 40 },
              arrivalTime: "19:00",
            }),
          },
        },
      ],
    });

  it("tells the planner what was already seen in the city being left", async () => {
    plan([]);

    await generateTransitDayStops("小樽", "札幌", "JPY", undefined, NEUTRAL_PREFERENCE_INTENT, [], [], ["小樽運河", "小樽蒸汽鐘"]);

    expect(createMock.mock.calls[0][0].messages[0].content).toContain("已經在 小樽 去過：小樽運河、小樽蒸汽鐘");
  });

  it("drops a morning stop that goes back to a visited place, under another name too", async () => {
    plan([{ name: "小樽運河散步" }, { name: "車站附近早餐" }]);

    const stops = await generateTransitDayStops("小樽", "札幌", "JPY", undefined, NEUTRAL_PREFERENCE_INTENT, [], [], ["小樽運河"]);

    const names = stops.map((s) => s.name);
    expect(names).not.toContain("小樽運河散步");
    expect(names).toContain("車站附近早餐");
  });

  it("says nothing when the city hasn't been visited yet", async () => {
    plan([]);

    await generateTransitDayStops("東京", "大阪", "JPY", undefined, NEUTRAL_PREFERENCE_INTENT);

    expect(createMock.mock.calls[0][0].messages[0].content).not.toContain("已經在");
  });
});

describe("withoutRevisits", () => {
  it("matches by name either way, ignoring spaces and brackets, but not one-character names", () => {
    const stops = [{ name: "小樽運河 散步" }, { name: "運河" }, { name: "早餐" }, { name: "茶" }];
    expect(withoutRevisits(stops, ["小樽運河", "茶"]).map((s) => s.name)).toEqual(["早餐", "茶"]);
  });
});

// 親子: the day winds down at 17:00, an hour before everyone else's.
describe("generateDayStops — with children", () => {
  it("ends the day by 17:00", async () => {
    const kidsIntent = { ...NEUTRAL_PREFERENCE_INTENT, pace: "intensive" as const, kids: true };
    const kidsDays = await generateDayStops("東京", 1, "JPY", [], undefined, kidsIntent);
    const usual = await generateDayStops("東京", 1, "JPY", [], undefined, { ...kidsIntent, kids: undefined });

    expect(kidsDays[0].length).toBeLessThan(usual[0].length);
  });
});

describe("親子 helpers", () => {
  it("drops 小酌 for a trip with children, even if 酒 was sent", async () => {
    const { mealPreferencesOf } = await import("./itineraryCityGen");
    const prefs = mealPreferencesOf({ ...NEUTRAL_PREFERENCE_INTENT, kids: true }, ["coffee", "alcohol"]);
    expect(prefs).toMatchObject({ drinks: ["coffee"], kids: true });
    expect(mealPreferencesOf(NEUTRAL_PREFERENCE_INTENT, ["alcohol"]).drinks).toEqual(["alcohol"]);
  });

  it("puts places Google says suit children first, keeps the unknown, drops the ruled out", async () => {
    const { childFriendlyFirst } = await import("./itineraryCityGen");
    const [a, b, c, d] = POOL;
    const ordered = childFriendlyFirst([
      a, // says nothing
      { ...b, menuForChildren: true },
      { ...c, goodForChildren: false, menuForChildren: false }, // Ramen Kamo to Negi
      { ...d, goodForChildren: false, menuForChildren: true }, // 一蘭: not "for children", but has a kids' menu
    ]);
    expect(ordered.map((p) => p.placeId)).toEqual([b.placeId, d.placeId, a.placeId]);
  });

  it("ends a day with children at 17:00", async () => {
    const { dayEndFor } = await import("./itineraryCityGen");
    expect(dayEndFor({ ...NEUTRAL_PREFERENCE_INTENT, kids: true })).toBe(17 * 60);
    expect(dayEndFor(NEUTRAL_PREFERENCE_INTENT)).toBe(18 * 60);
  });
});

// 長輩 (plan 1.5).
describe("generateThemedDayStops — with older relatives", () => {
  it("prefers a sight with an accessible entrance over an equally rated one", async () => {
    // the same rating and spot as the first plain place, listed last; only the entrance differs
    const plain = POOL.slice(0, 10).map((p) => ({ ...p, rating: 4.5 }));
    const accessible = { ...POOL[0], placeId: "ramp", name: "Ramp", rating: 4.5, accessibleEntrance: true };
    nearbyMock.mockResolvedValue([...plain, accessible]);
    const seniors = { ...NEUTRAL_PREFERENCE_INTENT, pace: "relaxed" as const, seniors: true };

    const { stopsByDay } = await generateThemedDayStops("東京", 1, "JPY", [], undefined, seniors);

    expect(stopsByDay[0].map((s) => s.placeId)).toContain("ramp");
  });

  it("ends the day at 17:00 like a trip with children", async () => {
    const { dayEndFor } = await import("./itineraryCityGen");
    expect(dayEndFor({ ...NEUTRAL_PREFERENCE_INTENT, seniors: true })).toBe(17 * 60);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlightInfo, PreferenceIntent, TripPreferences } from "@/lib/schemas";
import { NEUTRAL_PREFERENCE_INTENT } from "@/lib/schemas";
import { computeArrivalDayStartMinute } from "@/lib/scheduler/arrivalDayStart";

// Form-fidelity wiring tests: does each field on the home-page form actually
// reach the generator that's supposed to act on it? Every generator is
// mocked, so these only check plumbing, not LLM output quality.
//
// These started as `it.fails` known gaps (docs/process.md 2026-10-03 §6) and
// were flipped to plain `it` as plan/form-preference-wiring.md phase 1 fixed
// each one.

const planTripMock = vi.fn();
const dayStopsMock = vi.fn();
const themeByDayMock = vi.fn();
const transitStopsMock = vi.fn();
const departureStopsMock = vi.fn();
const mealsMock = vi.fn();
const parseIntentMock = vi.fn();

vi.mock("@/lib/openai", () => ({ openai: {} }));
vi.mock("@/lib/tripPlan", () => ({
  planTrip: (...args: unknown[]) => planTripMock(...args),
}));
vi.mock("@/lib/preferenceIntent", () => ({
  parsePreferenceIntent: (...args: unknown[]) => parseIntentMock(...args),
}));
vi.mock("@/lib/itineraryCityGen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/itineraryCityGen")>()),
  generateThemedDayStops: async (...args: unknown[]) => ({
    stopsByDay: await dayStopsMock(...args),
    themeByDay: themeByDayMock(...args),
  }),
  generateTransitDayStops: (...args: unknown[]) => transitStopsMock(...args),
  generateDepartureDayStops: (...args: unknown[]) => departureStopsMock(...args),
  generateMealsAndAccommodation: (...args: unknown[]) => mealsMock(...args),
}));

const { assembleItineraryDays } = await import("./assembleItineraryDays");

// 東京 3 days -> transit day -> 大阪 2 days (incl. transit) -> return day.
const flight: FlightInfo = {
  departureCity: "TPE",
  arrivalCity: "NRT",
  returnDepartureCity: "KIX",
  departureDate: "2026-12-01",
  returnDate: "2026-12-06",
  arrivalTime: "15:00",
  returnDepartureTime: "18:30",
};

// Argument positions of the generators' preferenceIntent / budget params.
const DAY_STOPS_BUDGET = 4;
const DAY_STOPS_INTENT = 5;
const DAY_STOPS_FIRST_START = 6;
const DAY_STOPS_LODGING = 7;
const DAY_STOPS_FIRST_THEME = 8;
const DEPARTURE_LODGING = 6;
const TRANSIT_BUDGET = 3;
const TRANSIT_INTENT = 4;
const DEPARTURE_TIME = 2;
const DEPARTURE_BUDGET = 3;
const DEPARTURE_INTENT = 4;
const MEALS_BUDGET = 3;

function run(prompt: string | undefined, preferences: TripPreferences | undefined) {
  return assembleItineraryDays(flight, prompt, preferences, "test-model");
}

function intentsPassed(): PreferenceIntent[] {
  const intents = [
    ...dayStopsMock.mock.calls.map((c) => c[DAY_STOPS_INTENT]),
    ...transitStopsMock.mock.calls.map((c) => c[TRANSIT_INTENT]),
    ...departureStopsMock.mock.calls.map((c) => c[DEPARTURE_INTENT]),
  ];
  // Otherwise a loop over this list passes vacuously if nothing was called.
  expect(intents.length).toBeGreaterThan(0);
  return intents;
}

beforeEach(() => {
  vi.clearAllMocks();
  planTripMock.mockResolvedValue({
    title: "東京大阪",
    currency: "JPY",
    cities: [
      { name: "東京", days: 3 },
      { name: "大阪", days: 2 },
    ],
  });
  dayStopsMock.mockImplementation(async (_city: string, count: number) =>
    Array.from({ length: count }, () => [])
  );
  themeByDayMock.mockImplementation((_city: string, count: number) => Array.from({ length: count }, () => undefined));
  transitStopsMock.mockResolvedValue([]);
  departureStopsMock.mockResolvedValue([]);
  mealsMock.mockImplementation(async (_city: string, nights: number) => ({
    accommodation: { name: "Hotel" },
    mealsByDay: Array.from({ length: nights }, () => ({})),
  }));
  parseIntentMock.mockResolvedValue(NEUTRAL_PREFERENCE_INTENT);
});

describe("assembleItineraryDays — form field wiring", () => {
  it("passes the form's pace/budget/interests and free text to planTrip", async () => {
    const prefs: TripPreferences = { pace: "intensive", budget: "luxury", interests: ["food"], travelers: 3 };
    await run("想多逛美術館", prefs);

    expect(planTripMock).toHaveBeenCalledWith(flight, "想多逛美術館", prefs, "test-model");
  });

  it("budget (預算) reaches every attraction, meal and lodging generator", async () => {
    await run(undefined, { budget: "budget" });

    expect(dayStopsMock.mock.calls.map((c) => c[DAY_STOPS_BUDGET])).toEqual(["budget", "budget"]);
    expect(transitStopsMock.mock.calls[0][TRANSIT_BUDGET]).toBe("budget");
    expect(departureStopsMock.mock.calls[0][DEPARTURE_BUDGET]).toBe("budget");
    expect(mealsMock.mock.calls.map((c) => c[MEALS_BUDGET])).toEqual(["budget", "budget"]);
  });

  it("arrival time (抵達時間) pushes back only the first city's first day", async () => {
    await run(undefined, undefined);

    expect(dayStopsMock.mock.calls[0][DAY_STOPS_FIRST_START]).toBe(computeArrivalDayStartMinute(15 * 60));
    expect(dayStopsMock.mock.calls[1][DAY_STOPS_FIRST_START]).toBeUndefined();
  });

  it("return departure time (回程出發時間) reaches the departure-day generator", async () => {
    await run(undefined, undefined);

    expect(departureStopsMock.mock.calls[0][DEPARTURE_TIME]).toBe("18:30");
  });

  it("schedules each city's stops around its chosen lodging", async () => {
    let mealsDone = false;
    mealsMock.mockImplementation(async (_city: string, nights: number) => {
      await Promise.resolve();
      mealsDone = true;
      return {
        accommodation: { name: "Hotel", lat: 35.68, lng: 139.77 },
        mealsByDay: Array.from({ length: nights }, () => ({})),
      };
    });
    dayStopsMock.mockImplementation(async (_city: string, count: number) => {
      // the lodging has to be known before stops can be scored by distance
      expect(mealsDone).toBe(true);
      return Array.from({ length: count }, () => []);
    });

    await run(undefined, undefined);

    for (const call of dayStopsMock.mock.calls) expect(call[DAY_STOPS_LODGING]).toEqual({ lat: 35.68, lng: 139.77 });
    expect(departureStopsMock.mock.calls[0][DEPARTURE_LODGING]).toEqual({ lat: 35.68, lng: 139.77 });
  });

  it("leaves the lodging location unset when the hotel has no coordinates", async () => {
    await run(undefined, undefined);
    // default mock accommodation is { name: "Hotel" } — generators fall back to the city center
    expect(dayStopsMock.mock.calls[0][DAY_STOPS_LODGING]).toBeUndefined();
  });

  it("a round-trip loop doesn't revisit places from the first stay in the arrival city", async () => {
    planTripMock.mockResolvedValue({
      title: "loop",
      currency: "JPY",
      cities: [
        { name: "東京", days: 2 },
        { name: "鎌倉", days: 2 },
        { name: "東京", days: 1 },
      ],
    });
    dayStopsMock.mockImplementation(async (city: string, count: number) =>
      Array.from({ length: count }, (_, i) => [{ placeId: `${city}-${i}` }])
    );

    await run(undefined, undefined);

    // calls: 東京 (first stay), 鎌倉 — the final 東京 block is only a transit + departure day
    const lockedForDeparture = departureStopsMock.mock.calls[0][5] as string[];
    expect(lockedForDeparture).toEqual(expect.arrayContaining(["東京-0", "東京-1"]));
    // the transit day arriving back in 東京 mustn't repeat them either
    const backToTokyo = transitStopsMock.mock.calls.find((c) => c[1] === "東京")!;
    expect(backToTokyo[5]).toEqual(expect.arrayContaining(["東京-0", "東京-1"]));
  });

  it("gives transit days the meals after arriving, and keeps every other day's meals aligned", async () => {
    mealsMock.mockImplementation(async (city: string, mealDays: number) => ({
      accommodation: { name: `${city} Hotel` },
      mealsByDay: Array.from({ length: mealDays }, (_, i) => ({ breakfast: `${city}-B${i}`, lunch: `${city}-L${i}` })),
    }));

    const result = await run(undefined, undefined);
    const days = result!.days as Array<{ isTransitDay?: boolean; meals?: Record<string, unknown> }>;

    // 東京: 3 sightseeing days. 大阪 (2 days): transit day + 1 sightseeing day + the return day.
    expect(mealsMock.mock.calls.map((c) => [c[0], c[1]])).toEqual([["東京", 3], ["大阪", 3]]);
    expect(days.map((d) => d.meals?.lunch)).toEqual(["東京-L0", "東京-L1", "東京-L2", "大阪-L0", "大阪-L1", "大阪-L2"]);
    const transit = days.find((d) => d.isTransitDay)!;
    expect(transit.meals).toEqual({ lunch: "大阪-L0" }); // no breakfast: still in 東京 that morning
  });

  it("pace (步調) reaches the per-day scheduler", async () => {
    await run(undefined, { pace: "intensive" });

    for (const intent of intentsPassed()) expect(intent.pace).toBe("intensive");
  });

  it("interests (興趣) reach the scheduler's interest weighting", async () => {
    await run(undefined, { interests: ["culture", "nature"] });

    for (const intent of intentsPassed()) {
      expect(intent.interestBoost).toEqual(expect.arrayContaining(["culture", "nature"]));
    }
  });

  it("free-text prompt is parsed into a PreferenceIntent and used for every day", async () => {
    const parsed: PreferenceIntent = {
      ...NEUTRAL_PREFERENCE_INTENT,
      startTimePreference: "early",
      avoid: ["long_walks"],
    };
    parseIntentMock.mockResolvedValue(parsed);

    await run("早點出門，不想走太多路", undefined);

    expect(parseIntentMock).toHaveBeenCalledWith("早點出門，不想走太多路", "test-model");
    for (const intent of intentsPassed()) {
      expect(intent).toMatchObject({ startTimePreference: "early", avoid: ["long_walks"] });
    }
  });

  it("dietary restrictions from free text reach the meal generator", async () => {
    parseIntentMock.mockResolvedValue({ ...NEUTRAL_PREFERENCE_INTENT, dietaryRestrictions: ["no_seafood"] });

    await run("不吃海鮮", undefined);

    expect(mealsMock).toHaveBeenCalled();
    for (const call of mealsMock.mock.calls) {
      expect(call).toContainEqual(expect.objectContaining({ dietaryRestrictions: ["no_seafood"] }));
    }
  });

  it("gives every night a 小酌 except the return day, which ends at the airport", async () => {
    mealsMock.mockImplementation(async (_city: string, nights: number) => ({
      accommodation: { name: "Hotel" },
      mealsByDay: Array.from({ length: nights }, () => ({ dinner: { name: "D" }, nightcap: { name: "Bar" } })),
    }));

    const result = await run(undefined, { drinks: ["alcohol"] });

    const days = result!.days;
    expect(days.slice(0, -1).every((d) => (d.meals as { nightcap?: unknown }).nightcap)).toBe(true);
    expect((days[days.length - 1].meals as { nightcap?: unknown }).nightcap).toBeUndefined();
  });

  it("drinks (飲品) reach the meal generator", async () => {
    await run(undefined, { drinks: ["coffee", "tea"] });

    expect(mealsMock).toHaveBeenCalled();
    for (const call of mealsMock.mock.calls) {
      expect(call).toContainEqual(expect.objectContaining({ drinks: ["coffee", "tea"] }));
    }
  });
});

describe("assembleItineraryDays — themed days", () => {
  it("titles a sightseeing day by its theme, and a day without one as 探索", async () => {
    themeByDayMock.mockImplementation((city: string) => (city === "東京" ? ["culture", undefined, "nature"] : ["culture"]));

    const result = await run(undefined, undefined);

    expect(result!.days.filter((d) => !d.isTransitDay).map((d) => d.theme)).toEqual([
      "東京 文化巡禮",
      "東京 探索",
      "東京 自然漫遊",
      "大阪 文化巡禮",
      "返程日",
    ]);
  });

  it("continues the theme rotation from city to city", async () => {
    await run(undefined, undefined);

    // 東京 has 3 sightseeing days, so 大阪's first day is the trip's 4th.
    expect(dayStopsMock.mock.calls.map((c) => c[DAY_STOPS_FIRST_THEME])).toEqual([0, 3]);
  });
});

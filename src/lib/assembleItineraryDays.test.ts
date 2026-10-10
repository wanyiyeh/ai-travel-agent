import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const planEventsMock = vi.fn();

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

vi.mock("@/lib/fixedEventVenues", () => ({
  planDayEvents: (...args: unknown[]) => planEventsMock(...args),
  restaurantNear: (...args: unknown[]) => restaurantNearMock(...args),
}));
const findRentalMock = vi.fn();
const findSuburbMock = vi.fn();
const inSeasonMock = vi.fn();
const climateMock = vi.fn();
vi.mock("@/lib/climate", () => ({
  isInSeason: (...args: unknown[]) => inSeasonMock(...args),
  getClimate: (...args: unknown[]) => climateMock(...args),
}));
const restaurantNearMock = vi.fn();
vi.mock("@/lib/suburbTrips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/suburbTrips")>()),
  findSuburbPlace: (...args: unknown[]) => findSuburbMock(...args),
}));
vi.mock("@/lib/placesTextSearch", () => ({ getCityCenter: async () => ({ lat: 35.68, lng: 139.76 }) }));
vi.mock("@/lib/carRental", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/carRental")>()),
  findCarRental: (...args: unknown[]) => findRentalMock(...args),
}));

const findClassicMock = vi.fn();
vi.mock("@/lib/classicDayTrips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/classicDayTrips")>()),
  findClassicDayTrip: (...args: unknown[]) => findClassicMock(...args),
}));
const findSeasonalMock = vi.fn();
vi.mock("@/lib/seasonalHighlights", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seasonalHighlights")>()),
  findSeasonalDay: (...args: unknown[]) => findSeasonalMock(...args),
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
  planEventsMock.mockImplementation(async () => ({ fixed: [], meals: {} }));
  // No suburb place or seasonal day unless a test offers one.
  findSuburbMock.mockResolvedValue(undefined);
  findSeasonalMock.mockResolvedValue(undefined);
  findClassicMock.mockResolvedValue(undefined);
  climateMock.mockResolvedValue(undefined);
  restaurantNearMock.mockResolvedValue(undefined);
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

// 固定行程: each event reaches the day it falls on.
describe("assembleItineraryDays — fixed events", () => {
  const concert = { type: "concert" as const, date: "2026-12-02", startTime: "18:00", venueName: "東京巨蛋" };
  const lunch = { type: "reservation" as const, date: "2026-12-03", startTime: "12:00", venueName: "叙々苑" };

  it("plans each event on the trip day its date falls on", async () => {
    await run(undefined, { fixedEvents: [concert, lunch] });

    // Trip starts 12-01: 東京 days 1-3 are 12-01..12-03.
    const tokyoDays = planEventsMock.mock.calls.filter((c) => c[1] === "東京").map((c) => c[0]);
    expect(tokyoDays).toEqual([[], [concert], [lunch]]);
  });

  it("hands each sightseeing day's planned events to the scheduler", async () => {
    const block = { startMinute: 18 * 60, endMinute: 21 * 60 };
    planEventsMock.mockImplementation(async (events: unknown[]) => ({
      fixed: events.length ? [{ block, stop: { id: "concert" } }] : [],
      meals: {},
    }));

    await run(undefined, { fixedEvents: [concert] });

    const tokyoCall = dayStopsMock.mock.calls.find((c) => c[0] === "東京")!;
    expect(tokyoCall[9]).toEqual([[], [{ block, stop: { id: "concert" } }], []]);
  });

  // 2d-2: a show in 大阪 on the day the trip moves there.
  it("hands a transit day's events to the transit-day generator, planned in the city being reached", async () => {
    const osakaShow = { type: "show" as const, date: "2026-12-04", startTime: "19:00", venueName: "大阪城ホール", city: "大阪" };
    const block = { startMinute: 18 * 60 + 30, endMinute: 21 * 60 + 30 };
    planEventsMock.mockImplementation(async (events: unknown[]) => ({
      fixed: events.length ? [{ block, stop: { id: "show" } }] : [],
      meals: {},
    }));

    await run(undefined, { fixedEvents: [osakaShow] });

    expect(planEventsMock).toHaveBeenCalledWith([osakaShow], "大阪", undefined, expect.anything());
    expect(transitStopsMock.mock.calls[0][6]).toEqual([{ block, stop: { id: "show" } }]);
  });

  it("plans an event booked on the return date on the last day", async () => {
    // 12-01 to 12-06 is 5 days (12-01..12-05), so 4 to allocate: 東京 3, then
    // 大阪's transit day; day 5 is the return day. (The shared fixture's
    // 東京 3 + 大阪 2 doesn't match these dates.)
    planTripMock.mockResolvedValue({ title: "t", currency: "JPY", cities: [{ name: "東京", days: 3 }, { name: "大阪", days: 1 }] });
    const lastLunch = { ...lunch, date: "2026-12-06" };

    const result = await run(undefined, { fixedEvents: [lastLunch] });

    expect(result!.days).toHaveLength(5);
    const lastCall = planEventsMock.mock.calls[planEventsMock.mock.calls.length - 1];
    expect(lastCall[0]).toEqual([lastLunch]);
  });

  it("lets a reservation replace that day's meal", async () => {
    planEventsMock.mockImplementation(async (events: Array<{ type: string }>) => ({
      fixed: [],
      meals: events.some((e) => e.type === "reservation") ? { lunch: { name: "叙々苑", fixedEvent: { type: "reservation" } } } : {},
    }));
    mealsMock.mockImplementation(async (_city: string, nights: number) => ({
      accommodation: { name: "Hotel" },
      mealsByDay: Array.from({ length: nights }, () => ({ lunch: { name: "Ramen" }, dinner: { name: "Sushi" } })),
    }));

    const result = await run(undefined, { fixedEvents: [lunch] });

    const day3 = result!.days.find((d) => d.day === 3)!;
    expect(day3.meals).toMatchObject({ lunch: { name: "叙々苑" }, dinner: { name: "Sushi" } });
  });
});

// 自駕 (plan/form-preference-wiring.md 1.7).
describe("assembleItineraryDays — self-drive", () => {
  beforeEach(() => {
    findRentalMock.mockReset();
    findRentalMock.mockImplementation(async (iata: string) => ({ placeId: iata, name: `${iata} Rental`, lat: 0, lng: 0 }));
  });

  it("starts day 1 with picking up the car at the arrival airport's counter", async () => {
    await run(undefined, { transport: "drive" });

    const firstDayEvents = dayStopsMock.mock.calls[0][9][0];
    expect(firstDayEvents[0].stop).toMatchObject({ name: "機場取車：NRT Rental" });
    expect(firstDayEvents[0].block.startMinute).toBe(computeArrivalDayStartMinute(15 * 60));
  });

  it("returns the car at the departure airport's counter on the last day", async () => {
    await run(undefined, { transport: "drive" });

    const makeReturn = departureStopsMock.mock.calls[0][8] as (minute: number) => Record<string, unknown>;
    expect(makeReturn(13 * 60)).toMatchObject({ name: "機場還車：KIX Rental" });
  });

  it("does none of it for public transport", async () => {
    await run(undefined, { transport: "transit" });

    expect(findRentalMock).not.toHaveBeenCalled();
    expect(departureStopsMock.mock.calls[0][8]).toBeUndefined();
  });
});

// 3b: a day out of the city (suburbTrips.ts). 東京 has 3 sightseeing days in the fixture.
describe("assembleItineraryDays — suburb trips", () => {
  const takao = { placeId: "takao", name: "高尾山", lat: 35.625, lng: 139.243, address: "", types: ["hiking_area"] };

  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "key");
    findSuburbMock.mockResolvedValue({ place: takao, group: "land" });
    restaurantNearMock.mockResolvedValue({ name: "Takao Soba", placeId: "soba" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gives a self-driver a whole day out on the city's second day, kept as planned", async () => {
    const result = await run(undefined, { transport: "drive" });

    const day2 = result!.days[1];
    expect(day2.theme).toBe("東京 一日遊：高尾山");
    expect(day2.isLocked).toBe(true);
    expect((day2.meals as { lunch: { name: string } }).lunch.name).toBe("Takao Soba");
    const blocks = dayStopsMock.mock.calls[0][9][1].map((e: { block: { endMinute: number } }) => e.block.endMinute);
    expect(blocks).toContain(18 * 60);
  });

  it("spends a whole day in a classic town first, sight by sight, with lunch there", async () => {
    const at = (placeId: string) => ({ placeId, name: placeId, lat: 35.23, lng: 139.1, address: "", types: ["tourist_attraction"] });
    findClassicMock.mockResolvedValue({ town: "箱根", km: 78, sights: [at("箱根神社"), at("大涌谷")] });

    const result = await run(undefined, undefined);

    const day2 = result!.days[1];
    expect(day2.theme).toBe("東京 一日遊：箱根");
    expect(day2.isLocked).toBe(true);
    expect(restaurantNearMock.mock.calls[0][2]).toBe("在箱根吃午餐");
    const events = dayStopsMock.mock.calls[0][9][1] as { stop: { placeId: string }; block: { endMinute: number } }[];
    expect(events.map((e) => e.stop.placeId)).toEqual(["箱根神社", "大涌谷"]);
    expect(events.at(-1)!.block.endMinute).toBe(18 * 60);
    expect(findSuburbMock).not.toHaveBeenCalled();
  });

  it("keeps a half day nearby, without looking for a classic town", async () => {
    planTripMock.mockResolvedValue({ title: "t", currency: "JPY", cities: [{ name: "東京", days: 2 }, { name: "大阪", days: 3 }] });

    await run(undefined, undefined);

    // 東京 and 大阪 both get 2 sightseeing days: half days, so no classic search
    expect(findClassicMock).not.toHaveBeenCalled();
  });

  it("checks the season on the day trip's own date", async () => {
    await run(undefined, undefined);

    const accept = findSuburbMock.mock.calls[0][5] as (place: unknown) => Promise<boolean>;
    await accept(takao);
    expect(inSeasonMock).toHaveBeenCalledWith(takao, "2026-12-02"); // 東京's second day
  });

  it("turns down a day trip into another city on the route", async () => {
    await run(undefined, undefined);

    const accept = findSuburbMock.mock.calls[0][5] as (place: unknown) => Promise<boolean>;
    // getCityCenter is mocked to one point for every city, so 大阪's center sits on this place
    expect(await accept({ ...takao, lat: 35.68, lng: 139.76 })).toBe(false);
  });

  it("gives public transport a day trip too, by train", async () => {
    const result = await run(undefined, { transport: "transit" });

    expect(result!.days[1].theme).toBe("東京 一日遊：高尾山");
    expect(findSuburbMock.mock.calls[0][3]).toBe(50);
  });

  it("gives a two-day stay a half day, with the afternoon in the city", async () => {
    planTripMock.mockResolvedValue({ title: "t", currency: "JPY", cities: [{ name: "東京", days: 2 }, { name: "大阪", days: 3 }] });

    const result = await run(undefined, undefined);

    expect(result!.days[1].theme).toBe("東京 半日遊：高尾山");
    expect(result!.days[1]).not.toHaveProperty("isLocked");
    // 大阪 3 days include the transit day: 2 sightseeing days, a half day too — no lunch out of town.
    expect(restaurantNearMock).not.toHaveBeenCalled();
  });

  it("plans nothing out of town when no place fits", async () => {
    findSuburbMock.mockResolvedValue(undefined);

    const result = await run(undefined, { transport: "drive" });

    expect(result!.days.map((d) => d.theme)).not.toContainEqual(expect.stringContaining("一日遊"));
  });
});

// 3c-2: a day around the month's seasonal places (seasonalHighlights.ts).
describe("assembleItineraryDays — seasonal day", () => {
  const place = (placeId: string) => ({ placeId, name: placeId, lat: 35.7, lng: 139.7, address: "", types: ["park"] });
  const ginkgo = place("神宮外苑銀杏並木");
  const rikugien = place("六義園");
  const lights = place("東京中城");

  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "key");
    findSeasonalMock.mockResolvedValue({
      label: "賞楓",
      highlights: [
        { place: ginkgo, night: false, note: "通常在 11 月下旬最美" },
        { place: rikugien, night: false, note: "" },
        { place: lights, night: true, note: "冬季點燈" },
      ],
    });
    dayStopsMock.mockImplementation(async (_city: string, count: number) =>
      Array.from({ length: count }, (_, i) => (i === 1 ? [{ placeId: "神宮外苑銀杏並木", description: "金黃色的銀杏大道。" }] : []))
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("titles the day, keeps its places for that day, and puts the illumination in the evening", async () => {
    const result = await run(undefined, undefined);

    // the arrival day goes last, so 東京's second day
    expect(result!.days[1].theme).toBe("東京 季節限定：賞楓");
    const [call] = dayStopsMock.mock.calls;
    expect(call[10][1].map((p: { placeId: string }) => p.placeId)).toEqual(["神宮外苑銀杏並木", "六義園"]);
    expect(call[9][1].map((e: { stop: { placeId: string } }) => e.stop.placeId)).toEqual(["東京中城"]);
    expect(findSeasonalMock.mock.calls[0][3]).toBe("2026-12-02");
  });

  it("adds the timing note after the place's own description", async () => {
    const result = await run(undefined, undefined);

    const stops = result!.days[1].stops as { description: string }[];
    expect(stops[0].description).toBe("金黃色的銀杏大道。 通常在 11 月下旬最美");
  });

  it("is skipped when the traveler unticks it", async () => {
    await run(undefined, { seasonalHighlights: false });

    expect(findSeasonalMock).not.toHaveBeenCalled();
  });
});

// 3c-4: each day's sunset, heat and rain (dayConditions.ts).
describe("assembleItineraryDays — sunset and weather", () => {
  // 12月 東京: dark by about 16:30, rain on a third of the days.
  const december = { avgMaxTempC: 12, avgSnowDepthM: 0, rainyDayShare: 0.3, sunsetFirstMinute: 988, sunsetLastMinute: 993 };

  beforeEach(() => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "key");
    climateMock.mockResolvedValue(december);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes each sightseeing day's sunset to the scheduler and shows it under the title", async () => {
    const result = await run(undefined, undefined);

    const conditions = dayStopsMock.mock.calls[0][11] as { sunsetMinute: number; hot: boolean; rainy: boolean }[];
    expect(conditions).toHaveLength(3);
    expect(conditions[0]).toEqual({ sunsetMinute: 988, hot: false, rainy: false, cold: false }); // 12月 1日
    expect(climateMock.mock.calls[1][2]).toBe("2026-12-02");
    expect(result!.days[0].weatherNote).toBe("日落約 16:28");
  });

  it("adds nothing when the weather is unknown", async () => {
    climateMock.mockResolvedValue(undefined);

    const result = await run(undefined, undefined);

    expect(result!.days[0]).not.toHaveProperty("weatherNote");
  });
});

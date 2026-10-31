import { beforeEach, describe, expect, it, vi } from "vitest";
import { signInAs } from "@tests/setup/mockAuth";

const findFirst = vi.fn();

// Only the validation paths are exercised here, which return before any
// OpenAI work or quota charge — the mocks just keep module loading hermetic
// (openai.ts throws at import time without OPENAI_API_KEY).
vi.mock("@/lib/openai", () => ({ openai: {} }));
const chargeMock = vi.fn();
vi.mock("@/lib/quota", () => ({ chargePaidEdit: (...args: unknown[]) => chargeMock(...args) }));
const updateMock = vi.fn();
const trashMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    itinerary: { findFirst: (...args: unknown[]) => findFirst(...args), update: (...args: unknown[]) => updateMock(...args) },
    deletedDay: { createMany: (...args: unknown[]) => trashMock(...args) },
    // getActor checks the signed-in user still exists (#225).
    user: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id }) },
    $transaction: async () => [],
  },
  j: (v: unknown) => v,
}));
// The generation pieces, for the apply path.
const stayDaysMock = vi.fn();
vi.mock("@/lib/cityStayDays", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cityStayDays")>()),
  buildStayDays: (...args: unknown[]) => stayDaysMock(...args),
}));
type MealOptions = { extraDays?: number; usedPlaceIds?: Iterable<string> };
const mealCalls: { city: string; options?: MealOptions }[] = [];
vi.mock("@/lib/itineraryCityGen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/itineraryCityGen")>()),
  generateTransitDayStops: async () => [],
  generateMealsAndAccommodation: async (city: string, nights: number, _c: unknown, _b: unknown, _p: unknown, options?: MealOptions) => {
    mealCalls.push({ city, options });
    return {
      accommodation: { name: "Hotel" },
      mealsByDay: Array.from({ length: nights }, () => ({})),
      ...(options?.extraDays
        ? {
            extraMealsByDay: Array.from({ length: options.extraDays }, (_, i) => ({
              breakfast: { name: `${city} breakfast${i || ""}` },
              lunch: { name: `${city} lunch${i || ""}` },
            })),
          }
        : {}),
    };
  },
}));
vi.mock("@/lib/preferenceIntent", () => ({
  parsePreferenceIntent: async () => ({ pace: null, startTimePreference: null, interestBoost: [], dietaryRestrictions: [], avoid: [] }),
}));

const { POST } = await import("./route");

function restructure(cities: unknown[]) {
  return POST(
    new Request("http://test/api", { method: "POST", body: JSON.stringify({ cities }) }),
    { params: Promise.resolve({ id: "itin-1" }) },
  );
}

const city = (targetDays: number) => ({ name: "京都", isNew: true, targetDays });

beforeEach(() => {
  findFirst.mockReset();
  signInAs({ id: "u1", email: "u1@example.com" });
  findFirst.mockResolvedValue(null);
});

describe("restructure input limits", () => {
  it("passes validation for a trip within the limits", async () => {
    const res = await restructure([city(14), city(14)]);
    // Gets as far as the itinerary lookup (mocked as not found).
    expect(res.status).toBe(404);
    expect(findFirst).toHaveBeenCalled();
  });

  it("rejects a city over the per-city day cap", async () => {
    const res = await restructure([city(15)]);
    expect(res.status).toBe(400);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("rejects a trip whose cities add up to more than the trip cap", async () => {
    const res = await restructure([city(14), city(14), city(3)]);
    expect(res.status).toBe(400);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("rejects an oversized city name", async () => {
    const res = await restructure([{ ...city(2), name: "a".repeat(201) }]);
    expect(res.status).toBe(400);
  });
});

describe("restructure keeps a booked event's day", () => {
  const concert = { type: "concert", date: "2026-11-12", startTime: "18:00", venueName: "東京巨蛋" };
  const concertStop = {
    name: "東京巨蛋",
    fixedEvent: { type: "concert", startTime: "18:00", endTime: "21:00", arriveBy: "17:00" },
  };

  beforeEach(() => {
    chargeMock.mockReset();
    findFirst.mockResolvedValue({
      id: "itin-1",
      userId: "u1",
      config: { preferences: { fixedEvents: [concert] } },
      days: [
        { id: "d1", day: 1, waypointCity: "東京", stops: [{ name: "淺草寺" }] },
        { id: "d2", day: 2, waypointCity: "東京", stops: [{ name: "上野公園" }, concertStop] },
        { id: "d3", day: 3, waypointCity: "東京", stops: [] },
      ],
    });
  });

  it("refuses to drop it, without charging the edit", async () => {
    const res = await restructure([{ name: "東京", isNew: false, targetDays: 2, keepDayIds: ["d1", "d3"] }]);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("第 2 天有固定行程（演唱會 11/12），不能移除");
    expect(chargeMock).not.toHaveBeenCalled();
  });
});

describe("restructure plans new days like a fresh trip", () => {
  const concert = { type: "concert", date: "2026-11-12", startTime: "18:00", venueName: "東京巨蛋" };
  const concertStop = { name: "東京巨蛋", fixedEvent: { type: "concert", startTime: "18:00", endTime: "21:00" } };

  beforeEach(() => {
    chargeMock.mockReset();
    stayDaysMock.mockReset();
    stayDaysMock.mockImplementation(async (input: { cityName: string; count: number }) => ({
      days: Array.from({ length: input.count }, () => ({ id: crypto.randomUUID(), theme: `${input.cityName} 文化巡禮`, stops: [] })),
      themedDays: input.count,
    }));
    // 東京 11/11-11/13: day 2 has the concert, day 3 is the last.
    findFirst.mockResolvedValue({
      id: "itin-1",
      userId: "u1",
      config: {
        currency: "JPY",
        flightInfo: { departureDate: "2026-11-11", returnDate: "2026-11-13", arrivalCity: "NRT" },
        preferences: { fixedEvents: [concert], interests: ["culture"] },
      },
      days: [
        { id: "d1", day: 1, waypointCity: "東京", stops: [{ name: "淺草寺", placeId: "p-asakusa" }] },
        { id: "d2", day: 2, waypointCity: "東京", stops: [concertStop] },
        { id: "d3", day: 3, waypointCity: "東京", stops: [] },
      ],
    });
  });

  it("dates each new day by where it lands, and doesn't book the kept concert twice", async () => {
    const res = await restructure([
      { name: "東京", isNew: false, targetDays: 4, keepDayIds: ["d1", "d2", "d3"] },
      { name: "大阪", isNew: true, targetDays: 2 },
    ]);
    expect(res.status).toBe(200);

    const calls = stayDaysMock.mock.calls.map(([input]) => input);
    const tokyo = calls.find((c) => c.cityName === "東京");
    const osaka = calls.find((c) => c.cityName === "大阪");
    // 東京's new day follows its two kept sightseeing days. 東京's last day moves
    // to the end of the trip, so 大阪 starts on day 4: its transit day, then day 5.
    expect(tokyo).toMatchObject({ count: 1, firstDayNumber: 3 });
    expect([...tokyo.usedPlaceIds]).toContain("p-asakusa");
    expect(osaka).toMatchObject({ count: 1, firstDayNumber: 5 });

    const saved = updateMock.mock.calls.length ? updateMock.mock.calls[0][0].data.days : undefined;
    expect(saved?.map((d: { theme?: string }) => d.theme)).toEqual([
      undefined, // d1, kept as it was
      undefined, // d2, the concert
      "東京 文化巡禮",
      "移動日：前往大阪",
      "大阪 文化巡禮",
      undefined, // d3, the return day, now last
    ]);

    const ctx = stayDaysMock.mock.calls[0][1];
    expect(ctx.eventsOn(2)).toEqual([]); // on kept day 2 already
    expect(ctx.departureDate).toBe("2026-11-11");
  });

  // #316: the new days started over from the top of the pool, repeating the kept days' restaurants.
  it("tells the meal picks which restaurants the city's kept days already have, in every block", async () => {
    findFirst.mockResolvedValue({
      id: "itin-1",
      userId: "u1",
      config: { currency: "JPY", flightInfo: { departureDate: "2026-11-11", returnDate: "2026-11-13", arrivalCity: "NRT" } },
      days: [
        { id: "d1", day: 1, waypointCity: "東京", stops: [], meals: { lunch: { name: "A", placeId: "p-lunch" }, dinner: { name: "B", placeId: "p-dinner" } } },
        { id: "d2", day: 2, waypointCity: "東京", stops: [], meals: { breakfast: { name: "C", placeId: "p-cafe" }, snack: null } },
        { id: "d3", day: 3, waypointCity: "東京", stops: [] },
      ],
    });
    mealCalls.length = 0;

    await restructure([
      { name: "東京", isNew: false, targetDays: 3, keepDayIds: ["d1", "d3"] },
      { name: "大阪", isNew: true, targetDays: 2 },
      { name: "東京", isNew: true, targetDays: 2 },
    ]);

    const used = (i: number) => [...(mealCalls.filter((c) => c.city === "東京")[i]?.options?.usedPlaceIds ?? [])];
    // d2 was dropped, so its café is free to pick again
    expect(used(0).sort()).toEqual(["p-dinner", "p-lunch"]);
    expect(used(1).sort()).toEqual(["p-dinner", "p-lunch"]);
    expect([...(mealCalls.find((c) => c.city === "大阪")?.options?.usedPlaceIds ?? [])]).toEqual([]);
  });
});

describe("restructure with a new city before an existing one", () => {
  beforeEach(() => {
    chargeMock.mockReset();
    updateMock.mockReset();
    trashMock.mockReset();
    stayDaysMock.mockReset();
    stayDaysMock.mockImplementation(async (input: { cityName: string; count: number }) => ({
      days: Array.from({ length: input.count }, () => ({ id: crypto.randomUUID(), theme: `AI ${input.cityName}`, stops: [] })),
      themedDays: input.count,
    }));
    // 東京 d1 + its day to 京都 (d2); 京都 d3, d4 and the trip's last day d5.
    findFirst.mockResolvedValue({
      id: "itin-1",
      userId: "u1",
      config: { currency: "JPY", flightInfo: { departureDate: "2026-11-11", returnDate: "2026-11-15", arrivalCity: "NRT" } },
      days: [
        { id: "d1", day: 1, theme: "東京1", waypointCity: "東京", stops: [] },
        {
          id: "d2",
          day: 2,
          theme: "移動日：前往京都",
          isTransitDay: true,
          transitTo: "京都",
          waypointCity: "東京",
          stops: [],
          meals: { breakfast: { name: "東京早餐" }, lunch: { name: "京都午餐" }, dinner: { name: "京都晚餐" } },
        },
        { id: "d3", day: 3, theme: "京都3", waypointCity: "京都", stops: [] },
        { id: "d4", day: 4, theme: "京都4", waypointCity: "京都", stops: [] },
        { id: "d5", day: 5, theme: "返程日", waypointCity: "京都", stops: [] },
      ],
    });
  });

  const themes = () => updateMock.mock.calls[0][0].data.days.map((d: { theme: string }) => d.theme);

  it("keeps every existing day with the day counts the wizard now sends", async () => {
    await restructure([
      { name: "東京", isNew: false, targetDays: 1, keepDayIds: ["d1", "d2"] },
      { name: "名古屋", isNew: true, targetDays: 2 },
      { name: "京都", isNew: false, targetDays: 4, keepDayIds: ["d3", "d4", "d5"] },
    ]);
    expect(themes()).toEqual(["東京1", "移動日：前往名古屋", "AI 名古屋", "移動日：前往京都", "京都3", "京都4", "返程日"]);
    expect(trashMock).not.toHaveBeenCalled();
  });

  // #290: these transit days used to have no meals at all, not even slots to pick.
  // #295: then no breakfast, and none at all into 京都; the replaced 東京 → 京都 day had them.
  it("gives both new transit days their meals, from the day they replace and 名古屋's picks", async () => {
    await restructure([
      { name: "東京", isNew: false, targetDays: 1, keepDayIds: ["d1", "d2"] },
      { name: "名古屋", isNew: true, targetDays: 2 },
      { name: "京都", isNew: false, targetDays: 4, keepDayIds: ["d3", "d4", "d5"] },
    ]);
    const days = updateMock.mock.calls[0][0].data.days as { theme: string; meals?: Record<string, unknown> }[];
    const meals = (theme: string) => days.find((d) => d.theme === theme)?.meals;
    // breakfast still in 東京, from the replaced day; lunch from 名古屋's candidates
    expect(meals("移動日：前往名古屋")).toEqual({ breakfast: { name: "東京早餐" }, lunch: { name: "名古屋 lunch" } });
    // breakfast from 名古屋's candidates, searched anyway; the rest in 京都, from the replaced day
    expect(meals("移動日：前往京都")).toEqual({
      breakfast: { name: "名古屋 breakfast1" },
      lunch: { name: "京都午餐" },
      dinner: { name: "京都晚餐" },
    });
  });

  it("puts a kept day that no longer fits in the trash rather than losing it", async () => {
    // The old counts: 京都's new transit day leaves no room for d4.
    await restructure([
      { name: "東京", isNew: false, targetDays: 2, keepDayIds: ["d1", "d2"] },
      { name: "名古屋", isNew: true, targetDays: 2 },
      { name: "京都", isNew: false, targetDays: 3, keepDayIds: ["d3", "d4", "d5"] },
    ]);
    const trashed = trashMock.mock.calls[0][0].data.map((row: { day: { id: string } }) => row.day.id);
    expect(trashed).toEqual(["d4"]); // not d2: a new day to 京都 replaces it
  });
});

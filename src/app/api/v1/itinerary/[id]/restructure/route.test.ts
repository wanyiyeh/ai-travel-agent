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
vi.mock("@/lib/db", () => ({
  prisma: {
    itinerary: { findFirst: (...args: unknown[]) => findFirst(...args), update: (...args: unknown[]) => updateMock(...args) },
    deletedDay: { createMany: vi.fn() },
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
vi.mock("@/lib/itineraryCityGen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/itineraryCityGen")>()),
  generateTransitDayStops: async () => [],
  generateMealsAndAccommodation: async (_city: string, nights: number) => ({
    accommodation: { name: "Hotel" },
    mealsByDay: Array.from({ length: nights }, () => ({})),
  }),
}));
vi.mock("@/lib/preferenceIntent", () => ({
  parsePreferenceIntent: async () => ({ pace: null, startTimePreference: null, interestBoost: [], dietaryRestrictions: [], avoid: [] }),
}));
vi.mock("@/lib/missingCopy", () => ({ fillMissingCopy: async () => {} }));

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
});

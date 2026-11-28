import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlightInfo } from "@/lib/schemas";

// Loop trips look up each town's center; no Google in unit tests.
vi.mock("@/lib/placesTextSearch", () => ({ getCityCenter: vi.fn(async () => null) }));

import { mockChatReply, mockMealCandidates, mockMealsAndLodgingReply, mockTripPlanReply } from "@/lib/mockAi";
import { planTrip } from "@/lib/tripPlan";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const flight = (arrivalCity: string, returnDepartureCity: string): FlightInfo => ({
  departureCity: "TPE",
  arrivalCity,
  returnDepartureCity,
  departureDate: "2026-11-10",
  returnDate: "2026-11-15",
});

describe("planTrip under MOCK_AI", () => {
  it.each([
    ["a round trip", flight("NRT", "NRT")],
    ["an open-jaw trip", flight("NRT", "KIX")],
  ])("%s gets a plan its own checks accept", async (_label, flightInfo) => {
    vi.stubEnv("MOCK_AI", "1");
    const plan = await planTrip(flightInfo, undefined, undefined, "mock");

    expect(plan).not.toBeNull();
    // Every day but the last is allocated to a city (TripPlanSchema).
    expect(plan!.cities.reduce((sum, c) => sum + c.days, 0)).toBe(4);
    expect(plan!.currency).toBe("JPY");
  });
});

describe("mockTripPlanReply", () => {
  it("never gives more cities than days, and every city at least one", () => {
    const reply = mockTripPlanReply({ arrivalCity: "東京", returnCity: "大阪", requiredCities: ["京都"], daysToAllocate: 2, currency: "JPY" });
    expect(reply.cities).toHaveLength(2);
    expect(reply.cities.every((c) => c.days >= 1)).toBe(true);
  });
});

describe("mockMealsAndLodgingReply", () => {
  it("names a lodging and four meals a day of its own", () => {
    const reply = mockMealsAndLodgingReply("東京", 2);

    expect(reply.accommodation).toMatchObject({ name: "東京 模擬住宿" });
    expect(reply.meals).toHaveLength(2);
    expect(Object.keys(reply.meals[0])).toEqual(["breakfast", "lunch", "dinner", "snack"]);
  });
});

describe("mockMealCandidates", () => {
  it("lists the fixed candidates when nothing was asked for", () => {
    expect(mockMealCandidates().map((c) => c.placeId)).toEqual(["mock-meal-current", "mock-meal-a", "mock-meal-b"]);
  });

  it("puts a place matching the request right after the current one", () => {
    const candidates = mockMealCandidates("拉麵");
    expect(candidates[0]).toMatchObject({ isCurrent: true });
    expect(candidates[1]).toMatchObject({ name: "Mock 拉麵", placeId: "mock-meal-wanted" });
    expect(candidates).toHaveLength(4);
  });
});

describe("mockChatReply restructure", () => {
  const cityDays = (...names: string[]) => names.map((waypointCity, i) => ({ id: `d${i + 1}`, day: i + 1, waypointCity, stops: [] }));

  it("adds a day to the first city for 多待", () => {
    const days = cityDays("首爾", "首爾", "首爾", "首爾", "首爾");
    expect(mockChatReply("restructure", days, ["首爾"], "多待一天")).toMatchObject({
      cities: [{ name: "首爾", days: 6, isNew: false }],
    });
  });

  it("takes a day off the first city for 少待, keeping the others", () => {
    const days = cityDays("東京", "東京", "東京", "京都", "京都");
    expect(mockChatReply("restructure", days, ["東京", "京都"], "少待一天")).toMatchObject({
      cities: [
        { name: "東京", days: 2, isNew: false },
        { name: "京都", days: 2, isNew: false },
      ],
    });
  });
});

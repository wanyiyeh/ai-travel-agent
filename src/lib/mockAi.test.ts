import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlightInfo } from "@/lib/schemas";

// Loop trips look up each town's center; no Google in unit tests.
vi.mock("@/lib/placesTextSearch", () => ({ getCityCenter: vi.fn(async () => null) }));

import { mockCompletion, mockMealsAndLodgingReply, mockTripPlanReply } from "@/lib/mockAi";
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

describe("mockCompletion", () => {
  it("stays out of the way when MOCK_AI is not set", async () => {
    vi.stubEnv("MOCK_AI", "");
    expect(await mockCompletion(() => ({ a: 1 }))).toBeNull();
  });

  it("answers with the reply as JSON content", async () => {
    vi.stubEnv("MOCK_AI", "1");
    const completion = await mockCompletion(() => ({ a: 1 }));
    expect(JSON.parse(completion!.choices[0].message.content!)).toEqual({ a: 1 });
  });

  it("fails like a request would under MOCK_AI=error", async () => {
    vi.stubEnv("MOCK_AI", "error");
    await expect(mockCompletion(() => ({}))).rejects.toThrow("MOCK_AI=error");
  });
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

describe("openai client under MOCK_AI", () => {
  it("refuses a real request instead of sending it", async () => {
    vi.stubEnv("MOCK_AI", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.resetModules();
    const { openai } = await import("@/lib/openai");

    await expect(
      openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow("MOCK_AI is set");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

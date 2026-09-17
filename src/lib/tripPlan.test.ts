import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlightInfo } from "@/lib/schemas";

const createMock = vi.fn();

// Same hermetic-test setup as preferenceIntent.test.ts — mocks @/lib/openai
// so the real module (which throws at import time without OPENAI_API_KEY)
// never loads.
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
}));

import { planTrip } from "@/lib/tripPlan";

function mockContent(content: string) {
  createMock.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

function mockJson(json: unknown) {
  mockContent(JSON.stringify(json));
}

const multiCityFlight: FlightInfo = {
  departureCity: "TPE",
  arrivalCity: "NRT",
  returnDepartureCity: "KIX",
  departureDate: "2026-05-01",
  returnDate: "2026-05-08", // 7 days -> 6 days to allocate across cities
};

const singleCityFlight: FlightInfo = {
  departureCity: "TPE",
  arrivalCity: "NRT",
  returnDepartureCity: "NRT",
  departureDate: "2026-05-01",
  returnDate: "2026-05-06", // 5 days -> 4 days to allocate
};

describe("planTrip", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("returns a valid multi-city plan whose days sum matches totalDays - 1", async () => {
    mockJson({
      title: "東京大阪之旅",
      currency: "JPY",
      cities: [{ name: "東京", days: 3 }, { name: "大阪", days: 3 }],
    });
    const result = await planTrip(multiCityFlight, "想去東京跟大阪", undefined, "gpt-4o-mini");
    expect(result).toEqual({
      title: "東京大阪之旅",
      currency: "JPY",
      cities: [{ name: "東京", days: 3 }, { name: "大阪", days: 3 }],
    });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("returns a valid single-city plan", async () => {
    mockJson({ title: "東京行", currency: "JPY", cities: [{ name: "東京", days: 4 }] });
    const result = await planTrip(singleCityFlight, undefined, undefined, "gpt-4o-mini");
    expect(result).toEqual({ title: "東京行", currency: "JPY", cities: [{ name: "東京", days: 4 }] });
  });

  it("retries once and returns null when the days don't sum to totalDays - 1", async () => {
    // sums to 4, needs 6
    mockJson({ title: "東京大阪之旅", currency: "JPY", cities: [{ name: "東京", days: 2 }, { name: "大阪", days: 2 }] });
    // sums to 3, still wrong
    mockJson({ title: "東京大阪之旅", currency: "JPY", cities: [{ name: "東京", days: 1 }, { name: "大阪", days: 2 }] });
    const result = await planTrip(multiCityFlight, undefined, undefined, "gpt-4o-mini");
    expect(result).toBeNull();
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("retries once and succeeds on the second attempt", async () => {
    mockContent("not valid json");
    mockJson({ title: "東京行", currency: "JPY", cities: [{ name: "東京", days: 6 }] });
    const result = await planTrip(multiCityFlight, undefined, undefined, "gpt-4o-mini");
    expect(result).toEqual({ title: "東京行", currency: "JPY", cities: [{ name: "東京", days: 6 }] });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when the response fails schema validation twice", async () => {
    mockJson({ title: "東京行", currency: "JPY", cities: [{ name: "", days: 3 }] });
    mockJson({ title: "東京行", currency: "JPY", cities: [] });
    const result = await planTrip(multiCityFlight, undefined, undefined, "gpt-4o-mini");
    expect(result).toBeNull();
  });

  it("returns null when the response is missing title or currency", async () => {
    mockJson({ cities: [{ name: "東京", days: 6 }] });
    mockJson({ cities: [{ name: "東京", days: 6 }] });
    const result = await planTrip(multiCityFlight, undefined, undefined, "gpt-4o-mini");
    expect(result).toBeNull();
  });

  it("returns null when the API call throws on both attempts", async () => {
    createMock.mockRejectedValueOnce(new Error("API down"));
    createMock.mockRejectedValueOnce(new Error("API down"));
    const result = await planTrip(multiCityFlight, undefined, undefined, "gpt-4o-mini");
    expect(result).toBeNull();
  });

  it("skips the call entirely for a same-day trip with no days left to allocate", async () => {
    const sameDayFlight: FlightInfo = {
      ...singleCityFlight,
      returnDate: singleCityFlight.departureDate,
    };
    const result = await planTrip(sameDayFlight, undefined, undefined, "gpt-4o-mini");
    expect(result).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });
});

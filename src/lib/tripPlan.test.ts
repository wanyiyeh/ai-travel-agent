import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlightInfo } from "@/lib/schemas";

const createMock = vi.fn();

// Same hermetic-test setup as preferenceIntent.test.ts — mocks @/lib/openai
// so the real module (which throws at import time without OPENAI_API_KEY)
// never loads.
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
}));

import { planTrip, rebalanceZeroDayCities } from "@/lib/tripPlan";

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

  it("repairs a squeezed-out last city instead of retrying (Paris -> Geneva -> Rome case)", async () => {
    mockJson({
      title: "東京大阪之旅",
      currency: "JPY",
      cities: [{ name: "東京", days: 4 }, { name: "京都", days: 2 }, { name: "大阪", days: 0 }],
    });
    const result = await planTrip(multiCityFlight, undefined, undefined, "gpt-4o-mini");
    expect(result?.cities).toEqual([
      { name: "東京", days: 3 },
      { name: "京都", days: 2 },
      { name: "大阪", days: 1 },
    ]);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("retries when there are more cities than days to give each one", async () => {
    // 7 cities, 6 days to allocate — can't give every city at least 1 day
    mockJson({
      title: "日本之旅",
      currency: "JPY",
      cities: [
        { name: "東京", days: 2 },
        { name: "橫濱", days: 1 },
        { name: "名古屋", days: 1 },
        { name: "京都", days: 1 },
        { name: "奈良", days: 1 },
        { name: "神戶", days: 0 },
        { name: "大阪", days: 0 },
      ],
    });
    mockJson({ title: "東京大阪之旅", currency: "JPY", cities: [{ name: "東京", days: 3 }, { name: "大阪", days: 3 }] });
    const result = await planTrip(multiCityFlight, undefined, undefined, "gpt-4o-mini");
    expect(result?.cities).toEqual([{ name: "東京", days: 3 }, { name: "大阪", days: 3 }]);
    expect(createMock).toHaveBeenCalledTimes(2);
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

describe("rebalanceZeroDayCities", () => {
  it("leaves a plan with no 0-day cities unchanged", () => {
    const cities = [{ name: "A", days: 3 }, { name: "B", days: 3 }];
    expect(rebalanceZeroDayCities(cities)).toEqual(cities);
  });

  it("takes each missing day from whichever city has the most at that point", () => {
    expect(
      rebalanceZeroDayCities([
        { name: "A", days: 5 },
        { name: "B", days: 0 },
        { name: "C", days: 3 },
        { name: "D", days: 0 },
      ])
    ).toEqual([
      { name: "A", days: 3 },
      { name: "B", days: 1 },
      { name: "C", days: 3 },
      { name: "D", days: 1 },
    ]);
  });

  it("returns null when no city can spare a day", () => {
    expect(rebalanceZeroDayCities([{ name: "A", days: 1 }, { name: "B", days: 1 }, { name: "C", days: 0 }])).toBeNull();
  });

  it("does not mutate its input", () => {
    const cities = [{ name: "A", days: 2 }, { name: "B", days: 0 }];
    rebalanceZeroDayCities(cities);
    expect(cities).toEqual([{ name: "A", days: 2 }, { name: "B", days: 0 }]);
  });
});

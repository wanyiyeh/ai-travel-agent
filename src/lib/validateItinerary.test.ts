import { describe, expect, it } from "vitest";
import { validateItinerary } from "@/lib/validateItinerary";
import type { FlightInfo } from "@/lib/schemas";
import type { Day, Itinerary, Stop } from "@/types/itinerary";

function makeStop(overrides: Partial<Stop> = {}): Stop {
  return {
    name: "景點",
    description: "描述",
    duration_minutes: 120,
    time_of_day: "morning",
    ...overrides,
  };
}

function makeFullMeals() {
  return {
    breakfast: { name: "早餐店" },
    lunch: { name: "午餐店" },
    dinner: { name: "晚餐店" },
    snack: { name: "點心店" },
  };
}

function makeDay(day: number, overrides: Partial<Day> = {}): Day {
  return {
    day,
    stops: [
      makeStop({ time_of_day: "morning" }),
      makeStop({ time_of_day: "afternoon" }),
    ],
    accommodation: { area: "某區" },
    meals: makeFullMeals(),
    ...overrides,
  };
}

function makeFlightInfo(overrides: Partial<FlightInfo> = {}): FlightInfo {
  return {
    departureCity: "TPE",
    arrivalCity: "TPE",
    returnDepartureCity: "TPE",
    departureDate: "2026-01-01",
    returnDate: "2026-01-04", // 3 days
    ...overrides,
  };
}

describe("validateItinerary — single-city, valid itinerary", () => {
  it("reports no errors for a well-formed 3-day single-city trip", () => {
    const itinerary: Itinerary = {
      title: "台北之旅",
      days: [
        makeDay(1),
        makeDay(2),
        makeDay(3, { accommodation: null }), // last day: no accommodation
      ],
    };
    const result = validateItinerary(itinerary, makeFlightInfo(), "台北", "台北");
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });
});

describe("validateItinerary — day count and sequence", () => {
  it("flags DAY_COUNT_MISMATCH when days.length doesn't match the flight date span", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [makeDay(1), makeDay(2, { accommodation: null })], // only 2 days, expects 3
    };
    const result = validateItinerary(itinerary, makeFlightInfo(), "台北", "台北");
    expect(result.issues.some((i) => i.code === "DAY_COUNT_MISMATCH")).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("flags DAY_NUMBER_SEQUENCE when day numbers are out of order", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [makeDay(1), makeDay(3), makeDay(2, { accommodation: null })],
    };
    const result = validateItinerary(itinerary, makeFlightInfo(), "台北", "台北");
    expect(result.issues.some((i) => i.code === "DAY_NUMBER_SEQUENCE")).toBe(true);
  });
});

describe("validateItinerary — transit day rules", () => {
  const multiCityFlight = makeFlightInfo({ arrivalCity: "NRT", returnDepartureCity: "KIX" });

  it("flags TRANSIT_DAY_MISSING for a multi-city trip with no transit day", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [makeDay(1), makeDay(2), makeDay(3, { accommodation: null })],
    };
    const result = validateItinerary(itinerary, multiCityFlight, "東京", "大阪");
    expect(result.issues.some((i) => i.code === "TRANSIT_DAY_MISSING")).toBe(true);
  });

  it("flags TRANSIT_DAY_UNEXPECTED for a single-city trip with a transit day", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [
        makeDay(1, { isTransitDay: true, transitTo: "台北", waypointCity: "台北" }),
        makeDay(2),
        makeDay(3, { accommodation: null }),
      ],
    };
    const result = validateItinerary(itinerary, makeFlightInfo(), "台北", "台北");
    expect(result.issues.some((i) => i.code === "TRANSIT_DAY_UNEXPECTED")).toBe(true);
  });

  it("flags TRANSIT_DAY_NO_TRANSITTO when a transit day omits transitTo", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [
        makeDay(1),
        makeDay(2, { isTransitDay: true, waypointCity: "大阪" }),
        makeDay(3, { accommodation: null, waypointCity: "大阪" }),
      ],
    };
    const result = validateItinerary(itinerary, multiCityFlight, "東京", "大阪");
    expect(result.issues.some((i) => i.code === "TRANSIT_DAY_NO_TRANSITTO")).toBe(true);
  });

  it("flags FINAL_CITY_MISMATCH when the last day's waypointCity isn't the return city", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [
        makeDay(1),
        makeDay(2, { isTransitDay: true, transitTo: "大阪", waypointCity: "東京" }),
        makeDay(3, { accommodation: null, waypointCity: "東京" }), // wrong: should be 大阪
      ],
    };
    const result = validateItinerary(itinerary, multiCityFlight, "東京", "大阪");
    expect(result.issues.some((i) => i.code === "FINAL_CITY_MISMATCH")).toBe(true);
  });

  it("does not require accommodation to be null on a transit day (current behaviour)", () => {
    // Regression guard: validateItinerary used to warn (TRANSIT_DAY_HAS_ACCOMMODATION)
    // when a transit day had accommodation. That rule was removed because the
    // traveler already sleeps in transitTo that night — a transit day WITH
    // accommodation is now correct, not a warning.
    const itinerary: Itinerary = {
      title: "t",
      days: [
        makeDay(1),
        makeDay(2, {
          isTransitDay: true,
          transitTo: "大阪",
          waypointCity: "東京",
          accommodation: { area: "大阪車站周邊" },
        }),
        makeDay(3, { accommodation: null, waypointCity: "大阪" }),
      ],
    };
    const result = validateItinerary(itinerary, multiCityFlight, "東京", "大阪");
    expect(result.issues.some((i) => i.code === "TRANSIT_DAY_HAS_ACCOMMODATION")).toBe(false);
  });
});

describe("validateItinerary — accommodation per day", () => {
  it("flags ACCOMMODATION_MISSING on a non-last day with no accommodation", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [
        makeDay(1, { accommodation: null }),
        makeDay(2),
        makeDay(3, { accommodation: null }),
      ],
    };
    const result = validateItinerary(itinerary, makeFlightInfo(), "台北", "台北");
    const issue = result.issues.find((i) => i.code === "ACCOMMODATION_MISSING");
    expect(issue).toBeDefined();
    expect(issue?.day).toBe(1);
    expect(result.valid).toBe(false);
  });

  it("flags ACCOMMODATION_MISSING on a transit day with no accommodation", () => {
    // This is the behaviour that flipped: transit days now REQUIRE
    // accommodation instead of forbidding it.
    const multiCityFlight = makeFlightInfo({ arrivalCity: "NRT", returnDepartureCity: "KIX" });
    const itinerary: Itinerary = {
      title: "t",
      days: [
        makeDay(1),
        makeDay(2, {
          isTransitDay: true,
          transitTo: "大阪",
          waypointCity: "東京",
          accommodation: null,
        }),
        makeDay(3, { accommodation: null, waypointCity: "大阪" }),
      ],
    };
    const result = validateItinerary(itinerary, multiCityFlight, "東京", "大阪");
    const issue = result.issues.find((i) => i.code === "ACCOMMODATION_MISSING");
    expect(issue).toBeDefined();
    expect(issue?.day).toBe(2);
  });

  it("flags LAST_DAY_HAS_ACCOMMODATION as a warning (not error) when the last day has one", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [makeDay(1), makeDay(2), makeDay(3)], // last day keeps accommodation
    };
    const result = validateItinerary(itinerary, makeFlightInfo(), "台北", "台北");
    const issue = result.issues.find((i) => i.code === "LAST_DAY_HAS_ACCOMMODATION");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    // A warning alone shouldn't make the whole itinerary invalid.
    expect(result.valid).toBe(true);
  });
});

describe("validateItinerary — per-day content", () => {
  it("flags DAY_TOO_FEW_STOPS when a non-transit day has fewer than 2 stops", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [
        makeDay(1, { stops: [makeStop()] }),
        makeDay(2),
        makeDay(3, { accommodation: null }),
      ],
    };
    const result = validateItinerary(itinerary, makeFlightInfo(), "台北", "台北");
    expect(result.issues.some((i) => i.code === "DAY_TOO_FEW_STOPS" && i.day === 1)).toBe(true);
  });

  it("flags DAY_MISSING_MEALS when no meal is set for a day", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [makeDay(1, { meals: {} }), makeDay(2), makeDay(3, { accommodation: null })],
    };
    const result = validateItinerary(itinerary, makeFlightInfo(), "台北", "台北");
    expect(result.issues.some((i) => i.code === "DAY_MISSING_MEALS" && i.day === 1)).toBe(true);
  });

  it("flags STOPS_ALL_SAME_TIME when every stop shares one time_of_day", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [
        makeDay(1, {
          stops: [
            makeStop({ time_of_day: "morning" }),
            makeStop({ time_of_day: "morning" }),
          ],
        }),
        makeDay(2),
        makeDay(3, { accommodation: null }),
      ],
    };
    const result = validateItinerary(itinerary, makeFlightInfo(), "台北", "台北");
    expect(result.issues.some((i) => i.code === "STOPS_ALL_SAME_TIME" && i.day === 1)).toBe(true);
  });
});

describe("validateItinerary — flight time conflicts", () => {
  it("flags FIRST_DAY_ARRIVAL_CONFLICT when arrival is after 14:00 but day 1 starts in the morning", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [makeDay(1), makeDay(2), makeDay(3, { accommodation: null })],
    };
    const flightInfo = makeFlightInfo({ arrivalTime: "18:30" });
    const result = validateItinerary(itinerary, flightInfo, "台北", "台北");
    expect(result.issues.some((i) => i.code === "FIRST_DAY_ARRIVAL_CONFLICT")).toBe(true);
  });

  it("does not flag FIRST_DAY_ARRIVAL_CONFLICT for an early arrival", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [makeDay(1), makeDay(2), makeDay(3, { accommodation: null })],
    };
    const flightInfo = makeFlightInfo({ arrivalTime: "09:00" });
    const result = validateItinerary(itinerary, flightInfo, "台北", "台北");
    expect(result.issues.some((i) => i.code === "FIRST_DAY_ARRIVAL_CONFLICT")).toBe(false);
  });

  it("flags LAST_DAY_DEPARTURE_CONFLICT when departure is before 15:00 but the last day ends in the evening", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [
        makeDay(1),
        makeDay(2),
        makeDay(3, {
          accommodation: null,
          stops: [
            makeStop({ time_of_day: "morning" }),
            makeStop({ time_of_day: "evening" }),
          ],
        }),
      ],
    };
    const flightInfo = makeFlightInfo({ returnDepartureTime: "10:00" });
    const result = validateItinerary(itinerary, flightInfo, "台北", "台北");
    expect(result.issues.some((i) => i.code === "LAST_DAY_DEPARTURE_CONFLICT")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { FlightInfoSchema, GenerateRequestSchema } from "@/lib/schemas";
import { MAX_PROMPT_LENGTH } from "@/lib/inputLimits";

const flightInfo = {
  departureCity: "TPE",
  arrivalCity: "NRT",
  returnDepartureCity: "NRT",
  departureDate: "2026-05-01",
  returnDate: "2026-05-06",
};

describe("FlightInfoSchema", () => {
  it("accepts a normal round trip", () => {
    expect(FlightInfoSchema.safeParse(flightInfo).success).toBe(true);
  });

  it("accepts exactly the maximum trip length", () => {
    expect(FlightInfoSchema.safeParse({ ...flightInfo, returnDate: "2026-05-31" }).success).toBe(true);
  });

  it("rejects a trip over the maximum length", () => {
    expect(FlightInfoSchema.safeParse({ ...flightInfo, returnDate: "2026-06-01" }).success).toBe(false);
    expect(FlightInfoSchema.safeParse({ ...flightInfo, returnDate: "2027-05-01" }).success).toBe(false);
  });

  it("rejects a return date on or before the departure date", () => {
    expect(FlightInfoSchema.safeParse({ ...flightInfo, returnDate: "2026-05-01" }).success).toBe(false);
    expect(FlightInfoSchema.safeParse({ ...flightInfo, returnDate: "2026-04-20" }).success).toBe(false);
  });

  it.each([
    ["not a date", "tomorrow"],
    ["wrong shape", "2026/05/06"],
    ["impossible day", "2026-02-31"],
    ["timestamp", "2026-05-06T00:00:00Z"],
  ])("rejects a malformed date (%s)", (_label, returnDate) => {
    expect(FlightInfoSchema.safeParse({ ...flightInfo, returnDate }).success).toBe(false);
  });
});

describe("GenerateRequestSchema", () => {
  it("accepts a request with no prompt or preferences", () => {
    expect(GenerateRequestSchema.safeParse({ flightInfo }).success).toBe(true);
  });

  it("rejects a missing flightInfo", () => {
    expect(GenerateRequestSchema.safeParse({ prompt: "hi" }).success).toBe(false);
    expect(GenerateRequestSchema.safeParse(null).success).toBe(false);
  });

  it("caps the prompt length", () => {
    expect(GenerateRequestSchema.safeParse({ flightInfo, prompt: "a".repeat(MAX_PROMPT_LENGTH) }).success).toBe(true);
    expect(GenerateRequestSchema.safeParse({ flightInfo, prompt: "a".repeat(MAX_PROMPT_LENGTH + 1) }).success).toBe(false);
  });

  it("rejects a non-string prompt", () => {
    expect(GenerateRequestSchema.safeParse({ flightInfo, prompt: { role: "system" } }).success).toBe(false);
  });

  it("rejects an oversized interests list", () => {
    // 8 options on the form (水上 and 陸上 replaced 冒險戶外, then 影劇追星), so 9 is too many.
    const interests = Array(9).fill("food");
    expect(GenerateRequestSchema.safeParse({ flightInfo, preferences: { interests } }).success).toBe(false);
  });
});

describe("TripPreferencesSchema — 同行者", () => {
  it("takes 親子 and 長輩 together", () => {
    expect(GenerateRequestSchema.safeParse({ flightInfo, preferences: { companions: ["kids", "seniors"] } }).success).toBe(true);
  });

  it("won't take 獨旅 with 親子 or 長輩", () => {
    expect(GenerateRequestSchema.safeParse({ flightInfo, preferences: { companions: ["solo", "kids"] } }).success).toBe(false);
    expect(GenerateRequestSchema.safeParse({ flightInfo, preferences: { companions: ["solo", "seniors"] } }).success).toBe(false);
  });
});

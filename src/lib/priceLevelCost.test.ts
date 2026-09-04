import { describe, expect, it } from "vitest";
import {
  estimateLodgingCostPerNight,
  estimateLodgingCostRange,
  estimateMealCost,
} from "@/lib/priceLevelCost";

describe("estimateMealCost", () => {
  // JPY breakfast range is [500, 1000].
  it.each([
    [1, 500],
    [2, 750],
    [3, 1000],
    [4, 1600],
  ])("maps priceLevel %i to %i for JPY breakfast", (priceLevel, expected) => {
    expect(estimateMealCost("JPY", "breakfast", priceLevel)).toBe(expected);
  });

  it("returns undefined for priceLevel 0 (Google's PRICE_LEVEL_FREE, not a usable signal)", () => {
    expect(estimateMealCost("JPY", "breakfast", 0)).toBeUndefined();
  });

  it("returns undefined for null/undefined priceLevel", () => {
    expect(estimateMealCost("JPY", "breakfast", null)).toBeUndefined();
    expect(estimateMealCost("JPY", "breakfast", undefined)).toBeUndefined();
  });

  it("returns undefined when currency is undefined", () => {
    expect(estimateMealCost(undefined, "breakfast", 2)).toBeUndefined();
  });

  it("returns undefined for a currency with no reference range", () => {
    expect(estimateMealCost("XXX", "breakfast", 2)).toBeUndefined();
  });
});

describe("estimateLodgingCostRange", () => {
  // JPY tiers are [6000, 12000, 22000, 45000].
  it.each([
    [1, [3300, 6000]],
    [2, [6000, 12000]],
    [3, [12000, 22000]],
    [4, [22000, 72000]],
  ])("maps priceLevel %i to range %j for JPY", (priceLevel, expected) => {
    expect(estimateLodgingCostRange("JPY", priceLevel)).toEqual(expected);
  });

  it("clamps out-of-range priceLevel (e.g. 5) to the top tier", () => {
    expect(estimateLodgingCostRange("JPY", 5)).toEqual([22000, 72000]);
  });

  it("returns undefined for priceLevel 0/null/undefined", () => {
    expect(estimateLodgingCostRange("JPY", 0)).toBeUndefined();
    expect(estimateLodgingCostRange("JPY", null)).toBeUndefined();
    expect(estimateLodgingCostRange("JPY", undefined)).toBeUndefined();
  });

  it("returns undefined for an unsupported currency", () => {
    expect(estimateLodgingCostRange("XXX", 2)).toBeUndefined();
  });
});

describe("estimateLodgingCostPerNight", () => {
  it("returns the midpoint of the priceLevel's range", () => {
    // JPY priceLevel 2 range is [6000, 12000] -> midpoint 9000.
    expect(estimateLodgingCostPerNight("JPY", 2)).toBe(9000);
  });

  it("returns undefined when the underlying range can't be resolved", () => {
    expect(estimateLodgingCostPerNight("XXX", 2)).toBeUndefined();
    expect(estimateLodgingCostPerNight("JPY", null)).toBeUndefined();
  });
});

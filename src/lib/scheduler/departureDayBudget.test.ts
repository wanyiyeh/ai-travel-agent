import { describe, expect, it } from "vitest";
import { computeDepartureDayBudget } from "@/lib/scheduler/departureDayBudget";

describe("computeDepartureDayBudget", () => {
  it("fits the max stop count when there's most of a day before the flight", () => {
    // 15:30 flight, 3hr buffer -> cutoff 12:30, default day start 08:00 -> 270min available
    const result = computeDepartureDayBudget(15 * 60 + 30);
    expect(result.cutoffMinute).toBe(12 * 60 + 30);
    expect(result.estimatedCount).toBe(3);
  });

  it("returns zero stops when the flight is too early to leave any time", () => {
    // 08:00 flight, 3hr buffer -> cutoff 05:00, before the 08:00 day start
    const result = computeDepartureDayBudget(8 * 60);
    expect(result.cutoffMinute).toBe(5 * 60);
    expect(result.estimatedCount).toBe(0);
  });

  it("returns zero stops when the cutoff lands exactly at the day start", () => {
    const result = computeDepartureDayBudget(11 * 60, 8 * 60);
    expect(result.cutoffMinute).toBe(8 * 60);
    expect(result.estimatedCount).toBe(0);
  });

  it("estimates a partial count for a modest window (1 stop)", () => {
    // 13:00 flight -> cutoff 10:00 -> 120min available -> floor(120/90) = 1
    const result = computeDepartureDayBudget(13 * 60);
    expect(result.estimatedCount).toBe(1);
  });

  it("estimates a partial count for a modest window (2 stops)", () => {
    // 14:00 flight -> cutoff 11:00 -> 180min available -> floor(180/90) = 2
    const result = computeDepartureDayBudget(14 * 60);
    expect(result.estimatedCount).toBe(2);
  });

  it("falls back to a conservative default cutoff when no return time is given", () => {
    const result = computeDepartureDayBudget(undefined);
    expect(result.cutoffMinute).toBe(14 * 60);
    expect(result.estimatedCount).toBe(3);
  });

  it("respects a custom dayStartMinute", () => {
    // Same 15:30 flight as the first test, but day starts later at 10:00 ->
    // cutoff still 12:30, only 150min available -> floor(150/90) = 1
    const result = computeDepartureDayBudget(15 * 60 + 30, 10 * 60);
    expect(result.estimatedCount).toBe(1);
  });
});

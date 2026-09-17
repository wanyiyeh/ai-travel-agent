import { describe, expect, it } from "vitest";
import { computeArrivalDayStartMinute } from "@/lib/scheduler/arrivalDayStart";

describe("computeArrivalDayStartMinute", () => {
  it("adds the 90 minute buffer to a given arrival time", () => {
    // 14:00 arrival -> 15:30 start
    expect(computeArrivalDayStartMinute(14 * 60)).toBe(15 * 60 + 30);
  });

  it("handles an early morning arrival", () => {
    // 07:00 arrival -> 08:30 start
    expect(computeArrivalDayStartMinute(7 * 60)).toBe(8 * 60 + 30);
  });

  it("falls back to a conservative default when no arrival time is given", () => {
    expect(computeArrivalDayStartMinute(undefined)).toBe(10 * 60);
  });
});

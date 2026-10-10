import { describe, expect, it } from "vitest";
import { blockStartDays, keptSightseeingDayNumber, type LayoutCity } from "@/lib/restructureLayout";

// 東京 d1-d3 (d3 the trip's last day), 大阪 added after it.
const tokyo = (targetDays: number, keepDayIds = ["d1", "d2", "d3"]): LayoutCity => ({ isNew: false, targetDays, keepDayIds });
const osaka: LayoutCity = { isNew: true, targetDays: 2, keepDayIds: [] };
const structural = (id: string) => id === "d3";

describe("blockStartDays", () => {
  it("starts each block after the ones before it", () => {
    expect(blockStartDays([tokyo(3)], "d3")).toEqual([1]);
    expect(blockStartDays([osaka, tokyo(3)], "d3")).toEqual([1, 3]);
  });

  it("starts the blocks after the old return day's city a day earlier, as that day moves to the end", () => {
    expect(blockStartDays([tokyo(3), osaka], "d3")).toEqual([1, 3]);
  });
});

describe("keptSightseeingDayNumber", () => {
  it("follows the kept days' order, after a transit day when the city before is new", () => {
    expect(keptSightseeingDayNumber([tokyo(3)], 0, "d2", structural, "d3")).toBe(2);
    // 大阪 (2 days) first: 東京's 4 days open on day 3 with a transit day, so d2 is day 5.
    expect(keptSightseeingDayNumber([osaka, tokyo(4)], 1, "d2", structural, "d3")).toBe(5);
  });

  it("is undefined for a day that isn't kept", () => {
    expect(keptSightseeingDayNumber([tokyo(2, ["d2", "d3"])], 0, "d1", structural, "d3")).toBeUndefined();
  });
});

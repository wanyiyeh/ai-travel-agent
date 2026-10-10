import { describe, expect, it } from "vitest";
import { conditionsOf, sunsetOn, weatherNote } from "@/lib/dayConditions";

// 東京 6月 2025 (probed): sunset 18:51 on the 1st, 19:00 on the 30th; rain on 18 of 30 days.
const juneTokyo = { avgMaxTempC: 27.5, avgSnowDepthM: 0, rainyDayShare: 18 / 30, sunsetFirstMinute: 18 * 60 + 51, sunsetLastMinute: 19 * 60 };

describe("sunsetOn", () => {
  it("moves from the month's first sunset to its last as the month goes on", () => {
    expect(sunsetOn(juneTokyo, "2026-06-01")).toBe(18 * 60 + 51);
    expect(sunsetOn(juneTokyo, "2026-06-30")).toBe(19 * 60);
    expect(sunsetOn(juneTokyo, "2026-06-15")).toBe(18 * 60 + 55);
  });
});

describe("conditionsOf", () => {
  it("calls a month rainy when it rained on over half the days", () => {
    expect(conditionsOf(juneTokyo, "2026-06-10")?.rainy).toBe(true);
    expect(conditionsOf({ ...juneTokyo, rainyDayShare: 10 / 30 }, "2026-11-10")?.rainy).toBe(false); // 東京 11月
  });

  it("calls a month hot from a 30°C average high", () => {
    expect(conditionsOf(juneTokyo, "2026-06-10")?.hot).toBe(false);
    expect(conditionsOf({ ...juneTokyo, avgMaxTempC: 32.8 }, "2026-08-10")?.hot).toBe(true);
  });

  it("knows nothing without the weather", () => {
    expect(conditionsOf(undefined, "2026-06-10")).toBeUndefined();
  });
});

describe("weatherNote", () => {
  it("gives the sunset, and a word on heat or rain when there's one to give", () => {
    expect(weatherNote({ sunsetMinute: 16 * 60 + 28, hot: false, rainy: false, cold: false })).toBe("日落約 16:28");
    expect(weatherNote({ sunsetMinute: 19 * 60, hot: true, rainy: true, cold: false })).toBe(
      "日落約 19:00・天氣炎熱，中午多排室內・這個月常下雨，記得帶傘"
    );
  });

  it("says rain or snow in a cold month", () => {
    // 札幌 11月 2025: a 3.6°C high, rain or snow on over half the days
    expect(weatherNote({ sunsetMinute: 16 * 60 + 17, hot: false, rainy: true, cold: true })).toBe("日落約 16:17・這個月常下雨或下雪，記得帶傘");
    expect(weatherNote(undefined)).toBeUndefined();
  });
});

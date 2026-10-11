import { describe, expect, it } from "vitest";
import { isBloomOutOfSeason, monthOf } from "@/lib/bloomSeasons";

describe("isBloomOutOfSeason", () => {
  it("knows a flower place by its name, and when it's out", () => {
    expect(isBloomOutOfSeason("白河林初埤木棉花道", 11)).toBe(true);
    expect(isBloomOutOfSeason("白河林初埤木棉花道", 3)).toBe(false);
    expect(isBloomOutOfSeason("新宿御苑 紅葉", 11)).toBe(false);
    expect(isBloomOutOfSeason("陽明山竹子湖 繡球花", 1)).toBe(true);
    // Its next pick for November.
    expect(isBloomOutOfSeason("花旗木步道", 11)).toBe(true);
    expect(isBloomOutOfSeason("花旗木步道", 4)).toBe(false);
  });

  it("leaves other places alone, and 薰衣草森林, a café chain", () => {
    expect(isBloomOutOfSeason("赤崁樓", 11)).toBe(false);
    expect(isBloomOutOfSeason("薰衣草森林 新社店", 11)).toBe(false);
  });
});

describe("monthOf", () => {
  it("reads the month of a date", () => {
    expect(monthOf("2026-11-10")).toBe(11);
  });
});

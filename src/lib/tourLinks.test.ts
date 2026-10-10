import { describe, expect, it } from "vitest";
import { isBigSight, tourLinks } from "@/lib/tourLinks";

describe("tourLinks", () => {
  it("searches KKday and Klook for the place", () => {
    expect(tourLinks("日光")).toEqual([
      { site: "KKday", url: "https://www.kkday.com/zh-tw/product/productlist?keyword=%E6%97%A5%E5%85%89" },
      { site: "Klook", url: "https://www.klook.com/zh-TW/search/result/?query=%E6%97%A5%E5%85%89" },
    ]);
  });
});

describe("isBigSight", () => {
  it("takes a half-day sight, not a quick stop or a booking", () => {
    expect(isBigSight({ placeId: "auschwitz", duration_minutes: 240 })).toBe(true);
    expect(isBigSight({ placeId: "shrine", duration_minutes: 90 })).toBe(false);
    expect(isBigSight({ placeId: "dome", duration_minutes: 240, fixedEvent: { type: "concert" } })).toBe(false);
    expect(isBigSight({ duration_minutes: 240 })).toBe(false); // a placeless step
  });
});

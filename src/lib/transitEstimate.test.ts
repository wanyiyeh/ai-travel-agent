import { describe, expect, it } from "vitest";
import { estimateTransit, isInJapan } from "@/lib/transitEstimate";

describe("isInJapan", () => {
  it.each([
    ["Tokyo", 35.6812, 139.7671],
    ["Osaka", 34.7025, 135.4959],
    ["Fukuoka", 33.5902, 130.4017],
    ["Nagasaki", 32.7503, 129.8777],
    ["Sapporo", 43.0618, 141.3545],
    ["Naha", 26.2124, 127.6809],
  ])("%s is in Japan", (_city, lat, lng) => {
    expect(isInJapan(lat, lng)).toBe(true);
  });

  it.each([
    ["Seoul", 37.5547, 126.9707],
    ["Busan", 35.1796, 129.0756],
    ["Jeju", 33.4996, 126.5312],
    ["Vladivostok", 43.1198, 131.8869],
    ["Taipei", 25.033, 121.5654],
    ["Stockholm", 59.3293, 18.0686],
  ])("%s is not", (_city, lat, lng) => {
    expect(isInJapan(lat, lng)).toBe(false);
  });
});

describe("estimateTransit", () => {
  it.each([
    ["Shinjuku→Shibuya", 3.4, 20],
    ["Tokyo Station→Shibuya", 6.8, 25],
    ["Shinjuku→Asakusa", 9.3, 35],
    ["Tokyo→Yokohama", 27, 60],
  ])("%s (%skm) takes about %i minutes", (_leg, km, minutes) => {
    expect(estimateTransit(km).durationSeconds).toBe(minutes * 60);
  });

  it("never estimates under 10 minutes — there's still the walk and the wait", () => {
    expect(estimateTransit(0.6).durationSeconds).toBe(10 * 60);
  });
});

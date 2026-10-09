import { describe, expect, it } from "vitest";
import { haversineKm, pickModeForDistance } from "@/lib/distanceMatrix";

describe("haversineKm", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineKm(35.6762, 139.6503, 35.6762, 139.6503)).toBe(0);
  });

  it("is symmetric regardless of argument order", () => {
    const a = haversineKm(25.033, 121.5654, 35.6762, 139.6503);
    const b = haversineKm(35.6762, 139.6503, 25.033, 121.5654);
    expect(a).toBeCloseTo(b, 9);
  });

  it("returns ~111.2 km per degree of latitude at the equator", () => {
    const km = haversineKm(0, 0, 1, 0);
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(112);
  });

  it("matches the known great-circle distance between Taipei and Taichung", () => {
    // Real-world distance is ~140 km; loose bounds so the test isn't brittle
    // against minor formula tweaks.
    const km = haversineKm(25.033, 121.5654, 24.1477, 120.6736);
    expect(km).toBeGreaterThan(120);
    expect(km).toBeLessThan(160);
  });
});

describe("pickModeForDistance", () => {
  it("walks up to 1.2km by default", () => {
    expect(pickModeForDistance(0.8)).toBe("walking");
  });

  // 室內行程為主: 500m is about 6-7 minutes in the sun.
  it("takes transit sooner with a shorter walk limit", () => {
    expect(pickModeForDistance(0.8, 0.5)).toBe("transit");
    expect(pickModeForDistance(0.4, 0.5)).toBe("walking");
  });
});

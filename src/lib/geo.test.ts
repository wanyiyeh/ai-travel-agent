import { describe, it, expect } from "vitest";
import { snapToGrid, haversineKm } from "./geo";

describe("snapToGrid", () => {
  it("maps nearby points to the same grid point", () => {
    // Two Cairo stops ~1km apart
    const a = snapToGrid({ lat: 30.0461, lng: 31.2624 }, 0.05);
    const b = snapToGrid({ lat: 30.0531, lng: 31.2551 }, 0.05);
    expect(a).toEqual(b);
    expect(a).toEqual({ lat: 30.05, lng: 31.25 });
  });

  it("has no float noise in the result", () => {
    expect(snapToGrid({ lat: 30.0499, lng: 14.4378 }, 0.05)).toEqual({ lat: 30.05, lng: 14.45 });
  });

  it("handles negative (southern / western) coordinates", () => {
    expect(snapToGrid({ lat: -33.8623, lng: 151.2077 }, 0.05)).toEqual({ lat: -33.85, lng: 151.2 });
    expect(snapToGrid({ lat: 40.7128, lng: -74.006 }, 0.05)).toEqual({ lat: 40.7, lng: -74 });
  });

  it("never moves a point more than half a grid cell diagonal", () => {
    const p = { lat: 35.0249, lng: 135.7749 }; // just under a half-cell boundary on both axes
    const s = snapToGrid(p, 0.05);
    // half-diagonal of a 0.05° cell at this latitude is ~3.5km
    expect(haversineKm(p.lat, p.lng, s.lat, s.lng)).toBeLessThan(4);
  });
});

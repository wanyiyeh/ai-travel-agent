import { describe, expect, it } from "vitest";
import { validateGeography } from "@/lib/validateGeography";
import type { Day, Itinerary, Stop } from "@/types/itinerary";

function makeStop(overrides: Partial<Stop> = {}): Stop {
  return {
    name: "景點",
    description: "描述",
    duration_minutes: 60,
    ...overrides,
  };
}

// Tokyo Station and Shibuya, ~6km apart — well under the 50km warning threshold.
const TOKYO_STATION = { lat: 35.6812, lng: 139.7671 };
const SHIBUYA = { lat: 35.658, lng: 139.7016 };
// Osaka, ~400km from Tokyo — well over the threshold.
const OSAKA = { lat: 34.6937, lng: 135.5023 };

describe("validateGeography", () => {
  it("returns no issues when consecutive stops are close together", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [
        {
          day: 1,
          stops: [makeStop({ ...TOKYO_STATION }), makeStop({ ...SHIBUYA })],
        } as Day,
      ],
    };
    expect(validateGeography(itinerary)).toHaveLength(0);
  });

  it("flags STOPS_TOO_FAR_APART when consecutive stops are over 50km apart", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [
        {
          day: 1,
          stops: [makeStop({ ...TOKYO_STATION }), makeStop({ ...OSAKA })],
        } as Day,
      ],
    };
    const issues = validateGeography(itinerary);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "STOPS_TOO_FAR_APART", severity: "warning", day: 1 });
  });

  it("skips the pair when either stop is missing coordinates", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [
        {
          day: 1,
          stops: [makeStop(), makeStop({ ...OSAKA })], // first stop has no lat/lng
        } as Day,
      ],
    };
    expect(validateGeography(itinerary)).toHaveLength(0);
  });

  it("does not compare a transit day's departure stop (index 0) against the arrival-city stops", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [
        {
          day: 2,
          isTransitDay: true,
          stops: [
            makeStop({ name: "移動", ...TOKYO_STATION }), // journey stop, expected to be far
            makeStop({ ...OSAKA }),
            makeStop({ ...OSAKA }), // same city, close together
          ],
        } as Day,
      ],
    };
    expect(validateGeography(itinerary)).toHaveLength(0);
  });

  it("still flags far-apart stops within the arrival city on a transit day", () => {
    const itinerary: Itinerary = {
      title: "t",
      days: [
        {
          day: 2,
          isTransitDay: true,
          stops: [
            makeStop({ name: "移動", ...TOKYO_STATION }),
            makeStop({ ...OSAKA }),
            makeStop({ ...TOKYO_STATION }), // wrong city for an arrival-city stop
          ],
        } as Day,
      ],
    };
    const issues = validateGeography(itinerary);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("STOPS_TOO_FAR_APART");
  });
});

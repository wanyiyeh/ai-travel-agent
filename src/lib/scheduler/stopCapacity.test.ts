import { describe, expect, it } from "vitest";
import { estimateStopCapacity, MAX_STOPS_PER_DAY } from "@/lib/scheduler/stopCapacity";

const fullDay = { dayStartMinute: 8 * 60, dayEndMinute: 18 * 60 };

describe("estimateStopCapacity", () => {
  it("fits ~3 deep-visit stops on a moderate day (about 3h each)", () => {
    // 600 min - 60 lunch = 540; (540 + 15) / (165 + 15) = 3.08
    expect(estimateStopCapacity({ pace: "moderate", ...fullDay, candidateTypes: ["museum", "park"] })).toBe(3);
  });

  it("gives a slower pace fewer stops for the same candidates", () => {
    const types = ["museum", "park", "landmark", "temple"];
    const counts = (["intensive", "moderate", "relaxed"] as const).map((pace) =>
      estimateStopCapacity({ pace, ...fullDay, candidateTypes: types })
    );
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
  });

  it("caps an intensive day of quick stops at MAX_STOPS_PER_DAY", () => {
    // 45-min landmarks would otherwise fit ~10
    expect(estimateStopCapacity({ pace: "intensive", ...fullDay, candidateTypes: ["landmark"] })).toBe(MAX_STOPS_PER_DAY);
  });

  it("returns 0 when a late arrival leaves no room for even one stop", () => {
    expect(
      estimateStopCapacity({ pace: "moderate", dayStartMinute: 17 * 60, dayEndMinute: 18 * 60, candidateTypes: ["museum"] })
    ).toBe(0);
    expect(
      estimateStopCapacity({ pace: "moderate", dayStartMinute: 19 * 60, dayEndMinute: 18 * 60, candidateTypes: ["museum"] })
    ).toBe(0);
  });

  it("only subtracts lunch when the day actually spans it", () => {
    // 15:00-20:00 at moderate landmarks: 300 / 135 = 2.2, no lunch deducted
    expect(
      estimateStopCapacity({ pace: "moderate", dayStartMinute: 15 * 60, dayEndMinute: 20 * 60, candidateTypes: ["landmark"] })
    ).toBe(2);
  });

  it("uses the pace's fallback stay when there are no candidate types yet", () => {
    // moderate fallback 150: (540 + 15) / 165 = 3.4
    expect(estimateStopCapacity({ pace: "moderate", ...fullDay, candidateTypes: [] })).toBe(3);
  });
});

describe("estimateStopCapacity with fixed blocks", () => {
  // A 3-hour evening concert from 15:00 leaves 9:00-15:00, minus lunch.
  it("counts only the time outside booked events", () => {
    const free = estimateStopCapacity({ pace: "moderate", dayStartMinute: 9 * 60, dayEndMinute: 18 * 60, candidateTypes: ["landmark"] });
    const withConcert = estimateStopCapacity({
      pace: "moderate",
      dayStartMinute: 9 * 60,
      dayEndMinute: 18 * 60,
      candidateTypes: ["landmark"],
      fixedBlocks: [{ startMinute: 15 * 60, endMinute: 18 * 60 }],
    });
    expect(withConcert).toBeLessThan(free);
    // 360 - 60 lunch = 300; (300 + 15) / 135 = 2.3
    expect(withConcert).toBe(2);
  });
});

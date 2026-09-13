import { describe, expect, it } from "vitest";
import { assignTimeOfDay } from "@/lib/scheduler/assignTimeSlots";

describe("assignTimeOfDay", () => {
  it("puts the first third of stops in the morning", () => {
    expect(assignTimeOfDay(0, 6)).toBe("morning");
    expect(assignTimeOfDay(1, 6)).toBe("morning");
  });

  it("puts the middle third of stops in the afternoon", () => {
    expect(assignTimeOfDay(2, 6)).toBe("afternoon");
    expect(assignTimeOfDay(3, 6)).toBe("afternoon");
  });

  it("puts the last third of stops in the evening", () => {
    expect(assignTimeOfDay(4, 6)).toBe("evening");
    expect(assignTimeOfDay(5, 6)).toBe("evening");
  });

  it("assigns a single stop to the morning", () => {
    expect(assignTimeOfDay(0, 1)).toBe("morning");
  });

  it("assigns the last stop to the evening regardless of count", () => {
    expect(assignTimeOfDay(9, 10)).toBe("evening");
    expect(assignTimeOfDay(99, 100)).toBe("evening");
  });
});

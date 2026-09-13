import { describe, expect, it } from "vitest";
import { assignTimeOfDay, assignTimeSlots } from "@/lib/scheduler/assignTimeSlots";

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

describe("assignTimeSlots", () => {
  it("accumulates duration + buffer across non-meal stops using type defaults", () => {
    const result = assignTimeSlots([
      { id: "a", type: "museum" },
      { id: "b", type: "viewpoint" },
    ]);

    expect(result[0]).toMatchObject({
      estimatedDurationMinutes: 90,
      startMinute: 480,
      endMinute: 570,
      time_of_day: "morning",
    });
    // moderate (default) pace buffer is 15 minutes: 570 + 15 = 585
    expect(result[1]).toMatchObject({
      estimatedDurationMinutes: 30,
      startMinute: 585,
      endMinute: 615,
      time_of_day: "morning",
    });
  });

  it("prefers an explicit durationMinutes over the type lookup table", () => {
    const [result] = assignTimeSlots([{ id: "a", type: "museum", durationMinutes: 20 }]);
    expect(result.estimatedDurationMinutes).toBe(20);
  });

  it("falls back to the default duration for an unknown type", () => {
    const [result] = assignTimeSlots([{ id: "a", type: "some_unlisted_type" }]);
    expect(result.estimatedDurationMinutes).toBe(60);
  });

  it("snaps a meal stop forward to the next meal window instead of starting immediately", () => {
    const [result] = assignTimeSlots([{ id: "breakfast", isMeal: true }], {
      dayStartMinute: 6 * 60, // 06:00, before the 07:00 breakfast window opens
    });
    expect(result.startMinute).toBe(7 * 60);
    expect(result.endMinute).toBe(8 * 60);
    expect(result.time_of_day).toBe("morning");
  });

  it("leaves a meal stop in place when the clock is already inside its window", () => {
    const [result] = assignTimeSlots([{ id: "lunch", isMeal: true }], {
      dayStartMinute: 12 * 60 + 10, // 12:10, already inside the lunch window
    });
    expect(result.startMinute).toBe(12 * 60 + 10);
  });

  it("clamps a meal stop to the clock instead of waiting when every window has passed", () => {
    const [result] = assignTimeSlots([{ id: "late-dinner", isMeal: true }], {
      dayStartMinute: 21 * 60 + 40, // 21:40, after the dinner window has closed
    });
    expect(result.startMinute).toBe(21 * 60 + 40);
  });

  it("spaces stops out more under a relaxed pace than an intensive one", () => {
    const stops = [
      { id: "a", durationMinutes: 60 },
      { id: "b", durationMinutes: 60 },
    ];
    const relaxed = assignTimeSlots(stops, { pace: "relaxed" });
    const intensive = assignTimeSlots(stops, { pace: "intensive" });

    expect(relaxed[1].startMinute).toBeGreaterThan(intensive[1].startMinute);
  });

  it("classifies time_of_day from clock time, not position in the list", () => {
    const [afternoonStop] = assignTimeSlots([{ id: "a", durationMinutes: 30 }], {
      dayStartMinute: 12 * 60,
    });
    expect(afternoonStop.time_of_day).toBe("afternoon");

    const [eveningStop] = assignTimeSlots([{ id: "a", durationMinutes: 30 }], {
      dayStartMinute: 18 * 60,
    });
    expect(eveningStop.time_of_day).toBe("evening");
  });
});

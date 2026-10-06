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
    const result = assignTimeSlots(
      [
        { id: "a", type: "museum" },
        { id: "b", type: "viewpoint" },
      ],
      { pace: "intensive" }
    );

    expect(result[0]).toMatchObject({
      estimatedDurationMinutes: 90,
      startMinute: 480,
      endMinute: 570,
      time_of_day: "morning",
    });
    // intensive pace buffer is 5 minutes: 570 + 5 = 575
    expect(result[1]).toMatchObject({
      estimatedDurationMinutes: 45,
      startMinute: 575,
      endMinute: 620,
      time_of_day: "morning",
    });
  });

  it("sets each stop's default stay by pace — pace is defined by how long you stay", () => {
    const stay = (pace: "intensive" | "moderate" | "relaxed", type: string) =>
      assignTimeSlots([{ id: "a", type }], { pace })[0].estimatedDurationMinutes;

    // plan/form-preference-wiring.md 1.2: intensive keeps every stop to 1.5h
    // or less, moderate gives places about 3h, relaxed longer still.
    expect([stay("intensive", "museum"), stay("moderate", "museum"), stay("relaxed", "museum")]).toEqual([90, 180, 210]);
    expect([stay("intensive", "park"), stay("moderate", "park"), stay("relaxed", "park")]).toEqual([60, 150, 180]);
    expect([stay("intensive", "landmark"), stay("moderate", "landmark"), stay("relaxed", "landmark")]).toEqual([45, 120, 150]);
  });

  it("prefers an explicit durationMinutes over the type lookup table", () => {
    const [result] = assignTimeSlots([{ id: "a", type: "museum", durationMinutes: 20 }]);
    expect(result.estimatedDurationMinutes).toBe(20);
  });

  it("falls back to the pace's default duration for an unknown type", () => {
    const [moderate] = assignTimeSlots([{ id: "a", type: "some_unlisted_type" }]);
    const [intensive] = assignTimeSlots([{ id: "a", type: "some_unlisted_type" }], { pace: "intensive" });
    expect(moderate.estimatedDurationMinutes).toBe(150);
    expect(intensive.estimatedDurationMinutes).toBe(60);
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

  it("takes lunch after the last stop that starts before noon", () => {
    const result = assignTimeSlots(
      [
        { id: "a", durationMinutes: 60 },
        { id: "b", durationMinutes: 60 },
        { id: "c", durationMinutes: 60 },
        { id: "d", durationMinutes: 60 },
      ],
      { dayStartMinute: 9 * 60 }
    );
    // 09:00, 10:15, 11:30-12:30, lunch 12:30-13:30, then 13:30
    expect(result.map((s) => s.startMinute)).toEqual([540, 615, 690, 810]);
    expect(result.map((s) => s.time_of_day)).toEqual(["morning", "morning", "morning", "afternoon"]);
  });

  // Story: with lunch fixed at 12:00-13:00, a budget Tokyo trip's first day
  // (10:00 start) moved the 3-hour museum to 13:00, left the morning empty,
  // and the next stop ran past 18:00 and was dropped — 1 stop that day.
  it("lets a long morning stop run into lunchtime and eats after it", () => {
    const result = assignTimeSlots(
      [
        { id: "museum", durationMinutes: 180 },
        { id: "market", durationMinutes: 150 },
      ],
      { dayStartMinute: 10 * 60 }
    );
    // museum 10:00-13:00, lunch 13:00-14:00, market 14:00
    expect(result.map((s) => s.startMinute)).toEqual([600, 840]);
  });

  it("eats first when a stop would end too late to have lunch after it", () => {
    const result = assignTimeSlots(
      [
        { id: "dome", durationMinutes: 120 },
        { id: "palace", durationMinutes: 180 },
      ],
      { dayStartMinute: 9 * 60 }
    );
    // dome 09:00-11:00; palace from 11:15 would end 14:15, past lunch's
    // latest start -> lunch 11:00-12:00, palace 12:00 (no longer 13:00)
    expect(result.map((s) => s.startMinute)).toEqual([540, 720]);
    expect(result[1].time_of_day).toBe("afternoon");
  });

  it("starts with lunch at 11:00 for a late riser whose first stop is long", () => {
    const result = assignTimeSlots([{ id: "museum", durationMinutes: 210 }], { dayStartMinute: 11 * 60 });
    expect(result[0].startMinute).toBe(12 * 60);
  });

  it("skips lunch on a day that starts after lunchtime", () => {
    const result = assignTimeSlots([{ id: "a", durationMinutes: 60 }], { dayStartMinute: 15 * 60 });
    expect(result[0].startMinute).toBe(15 * 60);
  });

  it("does not reserve a lunch break when the stops include their own meal", () => {
    const result = assignTimeSlots(
      [
        { id: "a", durationMinutes: 60 },
        { id: "lunch", isMeal: true },
      ],
      { dayStartMinute: 11 * 60 + 30 }
    );
    expect(result[0].startMinute).toBe(11 * 60 + 30);
    expect(result[1].startMinute).toBe(12 * 60 + 45);
  });

  it("spreads an attraction-only day out to dayEndMinute instead of finishing by noon (STOPS_ALL_SAME_TIME)", () => {
    const stops = [
      { id: "a", type: "landmark" },
      { id: "b", type: "temple" },
      { id: "c", type: "landmark" },
      { id: "d", type: "park" },
    ];
    // Intensive: short enough stays that the packed schedule ends by noon.
    const packed = assignTimeSlots(stops, { pace: "intensive" });
    const spread = assignTimeSlots(stops, { pace: "intensive", dayEndMinute: 18 * 60 });

    expect(new Set(packed.map((s) => s.time_of_day))).toEqual(new Set(["morning"]));
    expect(new Set(spread.map((s) => s.time_of_day))).toEqual(new Set(["morning", "afternoon"]));
    expect(spread[0].startMinute).toBe(8 * 60);
    expect(spread[spread.length - 1].endMinute).toBeLessThanOrEqual(18 * 60);
  });

  it("never stretches past dayEndMinute or leaves a gap over the cap", () => {
    const spread = assignTimeSlots(
      [
        { id: "a", durationMinutes: 30 },
        { id: "b", durationMinutes: 30 },
      ],
      { dayEndMinute: 22 * 60 }
    );
    // 15-minute moderate buffer + at most 120 minutes of stretch
    expect(spread[1].startMinute - spread[0].endMinute).toBe(135);
  });

  it("keeps the packed schedule when it already runs past dayEndMinute", () => {
    const stops = [
      { id: "a", durationMinutes: 120 },
      { id: "b", durationMinutes: 120 },
    ];
    expect(assignTimeSlots(stops, { dayEndMinute: 10 * 60 })).toEqual(assignTimeSlots(stops));
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

import { describe, expect, it } from "vitest";
import { blockOf, dateOfDay, eventStop, eventWindow, mealSlotOf } from "@/lib/fixedEvents";
import { FixedEventSchema, type FixedEvent } from "@/lib/schemas";
import { draftProblem } from "@/components/FixedEventsEditor";

const concert: FixedEvent = { type: "concert", date: "2026-11-11", startTime: "18:00", venueName: "東京巨蛋" };

describe("eventWindow", () => {
  it("defaults a concert to 3 hours when no end time was given", () => {
    expect(eventWindow(concert)).toEqual({ startMinute: 18 * 60, endMinute: 21 * 60 });
  });

  it("uses the end time when given", () => {
    expect(eventWindow({ ...concert, endTime: "20:30" }).endMinute).toBe(20 * 60 + 30);
  });

  it("defaults a reservation to an hour and a half", () => {
    const lunch: FixedEvent = { type: "reservation", date: "2026-11-11", startTime: "12:00", venueName: "叙々苑" };
    expect(eventWindow(lunch).endMinute).toBe(13 * 60 + 30);
  });
});

describe("mealSlotOf", () => {
  const at = (startTime: string): FixedEvent => ({ type: "reservation", date: "2026-11-11", startTime, venueName: "X" });

  it.each([
    ["12:00", "lunch"],
    ["18:30", "dinner"],
    ["16:00", "snack"],
  ])("a reservation at %s replaces the %s", (time, slot) => {
    expect(mealSlotOf(at(time))).toBe(slot);
  });

  it("marks a reservation's block as a meal, so it stands in for lunch", () => {
    expect(blockOf(at("12:00")).meal).toBe(true);
    expect(blockOf(concert).meal).toBeUndefined();
  });
});

describe("dateOfDay", () => {
  it("counts trip days from the departure date, across a month end", () => {
    expect(dateOfDay("2026-10-30", 1)).toBe("2026-10-30");
    expect(dateOfDay("2026-10-30", 3)).toBe("2026-11-01");
  });
});

describe("eventStop", () => {
  it("pins the booked time on the stop and places it at the venue", () => {
    const stop = eventStop(concert, { placeId: "dome", name: "東京巨蛋", lat: 35.7, lng: 139.75 });
    expect(stop).toMatchObject({
      name: "東京巨蛋",
      placeId: "dome",
      duration_minutes: 180,
      time_of_day: "evening",
      fixedEvent: { type: "concert", startTime: "18:00", endTime: "21:00" },
    });
  });

  it("calls work with no place given 在住宿工作", () => {
    const work: FixedEvent = { type: "work", date: "2026-11-11", startTime: "14:00", endTime: "17:00" };
    expect(eventStop(work, undefined).name).toBe("在住宿工作");
  });
});

describe("FixedEventSchema", () => {
  it("needs an end time for work", () => {
    expect(FixedEventSchema.safeParse({ type: "work", date: "2026-11-11", startTime: "14:00" }).success).toBe(false);
  });

  it("needs a place for everything but work", () => {
    expect(FixedEventSchema.safeParse({ ...concert, venueName: " " }).success).toBe(false);
  });

  it("rejects an end time before the start", () => {
    expect(FixedEventSchema.safeParse({ ...concert, endTime: "17:00" }).success).toBe(false);
  });
});

describe("draftProblem (the form)", () => {
  const draft = { type: "concert" as const, date: "2026-11-11", startTime: "18:00", endTime: "", venueName: "東京巨蛋" };

  it("accepts a complete row inside the trip", () => {
    expect(draftProblem(draft, "2026-11-10", "2026-11-14")).toBeUndefined();
  });

  it("flags a date outside the trip", () => {
    expect(draftProblem({ ...draft, date: "2026-11-20" }, "2026-11-10", "2026-11-14")).toBe("日期要在旅程期間內");
  });
});

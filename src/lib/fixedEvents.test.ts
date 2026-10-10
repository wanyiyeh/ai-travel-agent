import { describe, expect, it } from "vitest";
import {
  blockOf,
  bookedEventLabel,
  bookedEventOn,
  eventMeal,
  eventNotes,
  eventStop,
  eventWindow,
  fixedEventInfo,
  hasDinnerBefore,
  isDinnerBeforeStop,
  mealSlotOf,
  tripDayOfDate,
  type FixedEventInfo,
} from "@/lib/fixedEvents";
import { FixedEventSchema, type FixedEvent } from "@/lib/schemas";
import { draftProblem, toFixedEvent } from "@/components/FixedEventsEditor";

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

describe("tripDayOfDate across a month end", () => {
  it("counts trip days from the departure date", () => {
    expect(tripDayOfDate("2026-10-30", "2026-10-30", "2026-11-03")).toBe(1);
    expect(tripDayOfDate("2026-11-01", "2026-10-30", "2026-11-03")).toBe(3);
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

describe("eventMeal", () => {
  it("describes a reservation by its time, without repeating 訂位", () => {
    const lunch: FixedEvent = { type: "reservation", date: "2026-11-12", startTime: "12:00", venueName: "叙々苑 新宿" };
    expect(eventMeal(lunch, undefined).description).toBe("已訂位 12:00～13:30");
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
  const draft = { type: "concert" as const, date: "2026-11-11", startTime: "18:00", endTime: "", venueName: "東京巨蛋", arriveEarly: "", city: "" };

  it("accepts a complete row inside the trip", () => {
    expect(draftProblem(draft, "2026-11-10", "2026-11-14")).toBeUndefined();
  });

  it("flags a date outside the trip", () => {
    expect(draftProblem({ ...draft, date: "2026-11-20" }, "2026-11-10", "2026-11-14")).toBe("日期要在旅程期間內");
  });
});

// 2d-3: concerts, games and shows.
describe("arriving early", () => {
  it("blocks from 2 hours before a concert by default", () => {
    expect(blockOf(concert)).toEqual({ startMinute: 16 * 60, endMinute: 21 * 60 });
    expect(fixedEventInfo(concert).arriveBy).toBe("16:00");
  });

  it("uses the traveler's own choice, including not arriving early", () => {
    expect(blockOf({ ...concert, arriveEarlyMinutes: 30 }).startMinute).toBe(17 * 60 + 30);
    expect(fixedEventInfo({ ...concert, arriveEarlyMinutes: 0 })).not.toHaveProperty("arriveBy");
  });

  it("doesn't apply to work or reservations", () => {
    const work: FixedEvent = { type: "work", date: "2026-11-11", startTime: "14:00", endTime: "17:00", arriveEarlyMinutes: 60 };
    expect(blockOf(work).startMinute).toBe(14 * 60);
  });

  it("says when to be there on the stop", () => {
    expect(eventStop(concert, undefined).description).toBe("固定行程：演唱會 18:00～21:00，16:00 前到場");
  });
});

describe("dinner before a show", () => {
  it.each([
    ["18:00", true],
    ["16:00", true],
    ["13:00", false],
    ["21:30", false],
  ])("a concert at %s: %s", (startTime, expected) => {
    expect(hasDinnerBefore({ type: "concert", startTime })).toBe(expected);
  });

  it("doesn't apply to a work meeting in the evening", () => {
    expect(hasDinnerBefore({ type: "work", startTime: "18:00" })).toBe(false);
  });

  it("marks the stop made from an evening show for the timeline", () => {
    expect(isDinnerBeforeStop(eventStop(concert, undefined) as { fixedEvent?: FixedEventInfo })).toBe(true);
  });
});

describe("eventNotes", () => {
  it("reminds about the last train after a late finish", () => {
    expect(eventNotes({ ...concert, startTime: "19:30" }, undefined)).toEqual(["散場較晚，請留意末班車"]);
  });

  it("warns when the venue is far from the lodging", () => {
    expect(eventNotes(concert, 23.4)).toEqual(["場館離住宿約 23 km，散場回住宿較遠"]);
  });

  it("says nothing for an early finish near the lodging", () => {
    expect(eventNotes(concert, 3)).toEqual([]);
  });
});

describe("toFixedEvent (the form)", () => {
  const draft = { type: "concert" as const, date: "2026-11-11", startTime: "18:00", endTime: "", venueName: "東京巨蛋", arriveEarly: "", city: "" };

  it("leaves arriving early to the type's default when not chosen", () => {
    expect(toFixedEvent(draft)).not.toHaveProperty("arriveEarlyMinutes");
  });

  it("sends the chosen time, including 0", () => {
    expect(toFixedEvent({ ...draft, arriveEarly: "0" }).arriveEarlyMinutes).toBe(0);
  });

  it("drops it for types that don't arrive early", () => {
    expect(toFixedEvent({ ...draft, type: "reservation", arriveEarly: "60" })).not.toHaveProperty("arriveEarlyMinutes");
  });
});

// Day N is departureDate + (N - 1); a 11/10-11/16 trip has 6 days, the last
// (返程日) dated 11/15.
describe("tripDayOfDate", () => {
  it.each([
    ["2026-11-10", 1],
    ["2026-11-13", 4],
    ["2026-11-15", 6],
  ])("%s is day %i", (date, day) => {
    expect(tripDayOfDate(date, "2026-11-10", "2026-11-16")).toBe(day);
  });

  // Story: the form allowed the return date, which matched no day, so an
  // event booked on it was silently dropped.
  it("puts an event on the return date on the last day", () => {
    expect(tripDayOfDate("2026-11-16", "2026-11-10", "2026-11-16")).toBe(6);
  });

  it("has no day for a date outside the trip", () => {
    expect(tripDayOfDate("2026-11-09", "2026-11-10", "2026-11-16")).toBeUndefined();
    expect(tripDayOfDate("2026-11-17", "2026-11-10", "2026-11-16")).toBeUndefined();
  });
});

describe("bookedEventOn", () => {
  const lunch: FixedEvent = { type: "reservation", date: "2026-11-12", startTime: "12:00", venueName: "すきやばし次郎" };
  const errand: FixedEvent = { type: "other", date: "2026-11-13", startTime: "10:00", venueName: "大使館" };

  it("finds the traveler's event among a day's stops, or as a meal", () => {
    expect(bookedEventOn({ stops: [{ name: "淺草寺" }, eventStop(concert, undefined)] }, [concert, lunch])).toBe(concert);
    expect(bookedEventOn({ stops: [], meals: { lunch: eventMeal(lunch, undefined), dinner: null } }, [concert, lunch])).toBe(lunch);
    expect(bookedEventOn({ stops: [{ name: "淺草寺" }] }, [concert])).toBeUndefined();
  });

  it("doesn't take the rental counter for an 'other' event at the same time", () => {
    const pickup = { name: "取車：Times Car 成田機場", fixedEvent: { type: "other", startTime: "10:00", endTime: "10:30" } };
    expect(bookedEventOn({ stops: [pickup] }, [errand])).toBeUndefined();
    expect(bookedEventOn({ stops: [eventStop(errand, undefined)] }, [errand])).toBe(errand);
  });
});

describe("bookedEventLabel", () => {
  it("names the event and its date", () => {
    expect(bookedEventLabel(concert)).toBe("演唱會 11/11");
  });
});

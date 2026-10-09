import type { FixedBlock } from "@/lib/scheduler/assignTimeSlots";
import type { FixedEvent, FixedEventType } from "@/lib/schemas";

// 固定行程 (plan/form-preference-wiring.md 1.11): things the traveler has
// already booked. Their time is locked and the day is planned around it.

type EventTypeInfo = {
  label: string;
  /** Length when no end time was given. Work always needs one (the schema requires it). */
  defaultMinutes: number;
};

export const FIXED_EVENT_TYPES: Record<FixedEventType, EventTypeInfo> = {
  concert: { label: "演唱會", defaultMinutes: 180 },
  sports: { label: "球賽", defaultMinutes: 180 },
  show: { label: "表演", defaultMinutes: 150 },
  reservation: { label: "餐廳訂位", defaultMinutes: 90 },
  work: { label: "工作", defaultMinutes: 120 },
  other: { label: "其他", defaultMinutes: 120 },
};

/** "18:30" -> 1110. */
export function minuteOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (minute: number) => `${pad(Math.floor(minute / 60) % 24)}:${pad(minute % 60)}`;

// Concerts, games and shows: being there early (queue, merch, dinner nearby)
// is part of the evening — plan 1.11.
const SHOW_TYPES = new Set<FixedEventType>(["concert", "sports", "show"]);
export const ARRIVE_EARLY_DEFAULT_MINUTES: Partial<Record<FixedEventType, number>> = { concert: 120, sports: 60, show: 30 };

export function isShowEvent(event: Pick<FixedEvent, "type">): boolean {
  return SHOW_TYPES.has(event.type);
}

/** How long before the start the traveler should be at the venue. */
export function arriveEarlyMinutes(event: FixedEvent): number {
  if (!isShowEvent(event)) return 0;
  return event.arriveEarlyMinutes ?? ARRIVE_EARLY_DEFAULT_MINUTES[event.type] ?? 0;
}

// A show starting in this window gets dinner near the venue before it,
// instead of a dinner shown after a 21:00 finish.
const DINNER_BEFORE_START = { from: 16 * 60, to: 21 * 60 };

/** Whether a fixed event (or the stop made from it) has dinner before it, near the venue. */
export function hasDinnerBefore(event: { type: FixedEventType; startTime: string }): boolean {
  const start = minuteOf(event.startTime);
  return SHOW_TYPES.has(event.type) && start >= DINNER_BEFORE_START.from && start <= DINNER_BEFORE_START.to;
}

/** For the timeline: a stop made from an evening show, which dinner comes before. */
export function isDinnerBeforeStop(stop: { fixedEvent?: FixedEventInfo }): boolean {
  return stop.fixedEvent !== undefined && hasDinnerBefore(stop.fixedEvent);
}

// After this, the last train is worth a reminder (a fixed threshold — no
// timetable lookup).
const LATE_END_MINUTE = 22 * 60 + 30;
// A venue this far from the lodging gets a "long way back" note.
export const FAR_FROM_LODGING_KM = 10;

export function eventWindow(event: FixedEvent): { startMinute: number; endMinute: number } {
  const startMinute = minuteOf(event.startTime);
  const endMinute = event.endTime ? minuteOf(event.endTime) : startMinute + FIXED_EVENT_TYPES[event.type].defaultMinutes;
  return { startMinute, endMinute: Math.max(endMinute, startMinute + 15) };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Which itinerary day (1-based) a fixed event's date falls on. Day N is
 * departureDate + (N - 1) and the trip has returnDate - departureDate days
 * (the same count as calcDays), so the return date itself is one past the
 * last day — an event booked on it goes on the last day, the 返程日, rather
 * than being dropped. Undefined outside the trip.
 */
export function tripDayOfDate(date: string, departureDate: string, returnDate: string): number | undefined {
  const totalDays = Math.max(
    1,
    Math.ceil((new Date(`${returnDate}T00:00:00Z`).getTime() - new Date(`${departureDate}T00:00:00Z`).getTime()) / MS_PER_DAY)
  );
  if (date === returnDate) return totalDays;
  const day = Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${departureDate}T00:00:00Z`).getTime()) / MS_PER_DAY) + 1;
  return day >= 1 && day <= totalDays ? day : undefined;
}

/** A reservation stands in for a meal rather than adding a stop. */
export function isMealEvent(event: FixedEvent): boolean {
  return event.type === "reservation";
}

/** Which meal a reservation replaces, by when it starts: lunch 11:00-15:00, dinner from 17:00, else the snack. */
export function mealSlotOf(event: FixedEvent): "lunch" | "dinner" | "snack" {
  const start = minuteOf(event.startTime);
  if (start >= 11 * 60 && start < 15 * 60) return "lunch";
  if (start >= 17 * 60) return "dinner";
  return "snack";
}

/** The time no other stop may use: the event itself plus arriving early. */
export function blockOf(event: FixedEvent): FixedBlock {
  const { startMinute, endMinute } = eventWindow(event);
  return { startMinute: startMinute - arriveEarlyMinutes(event), endMinute, ...(isMealEvent(event) ? { meal: true } : {}) };
}

/** What a fixed event is shown as: 「演唱會 18:00～21:00」. */
export function eventTimeLabel(event: FixedEvent): string {
  const { startMinute, endMinute } = eventWindow(event);
  return `${FIXED_EVENT_TYPES[event.type].label} ${hhmm(startMinute)}～${hhmm(endMinute)}`;
}

/** Stored on a stop or meal made from a fixed event, so the UI can pin it and keep 換一個 off it. */
export type FixedEventInfo = { type: FixedEventType; startTime: string; endTime: string; arriveBy?: string };

export function fixedEventInfo(event: FixedEvent): FixedEventInfo {
  const { startMinute, endMinute } = eventWindow(event);
  const early = arriveEarlyMinutes(event);
  return {
    type: event.type,
    startTime: hhmm(startMinute),
    endTime: hhmm(endMinute),
    ...(early > 0 ? { arriveBy: hhmm(startMinute - early) } : {}),
  };
}

/** Reminders for the event's description: a late finish, a long way back to the lodging. */
export function eventNotes(event: FixedEvent, kmFromLodging: number | undefined): string[] {
  const notes: string[] = [];
  if (isShowEvent(event) && eventWindow(event).endMinute >= LATE_END_MINUTE) notes.push("散場較晚，請留意末班車");
  if (kmFromLodging !== undefined && kmFromLodging > FAR_FROM_LODGING_KM) {
    notes.push(`場館離住宿約 ${Math.round(kmFromLodging)} km，散場回住宿較遠`);
  }
  return notes;
}

export type Venue = { placeId?: string; name: string; lat: number; lng: number; address?: string };

/**
 * The stop a fixed event becomes. `venue` is the looked-up place, or the
 * lodging for work with no place given; without either, the stop keeps the
 * traveler's own wording and has no coordinates.
 */
export function eventStop(event: FixedEvent, venue: Venue | undefined, notes: string[] = []): Record<string, unknown> {
  const { startMinute, endMinute } = eventWindow(event);
  const name = event.venueName?.trim() || venue?.name || (event.type === "work" ? "在住宿工作" : FIXED_EVENT_TYPES[event.type].label);
  const arriveBy = fixedEventInfo(event).arriveBy;
  const description = [
    `固定行程：${eventTimeLabel(event)}${arriveBy ? `，${arriveBy} 前到場` : ""}`,
    ...notes,
  ].join("。");
  return {
    id: crypto.randomUUID(),
    name,
    description,
    duration_minutes: endMinute - startMinute,
    time_of_day: startMinute < 12 * 60 ? "morning" : startMinute < 18 * 60 ? "afternoon" : "evening",
    fixedEvent: fixedEventInfo(event),
    ...(venue
      ? { placeId: venue.placeId, lat: venue.lat, lng: venue.lng, address: venue.address }
      : {}),
  };
}

/** The same place as a meal (a reservation replacing lunch or dinner). */
export function eventMeal(event: FixedEvent, venue: Venue | undefined): Record<string, unknown> {
  return {
    name: event.venueName?.trim() || venue?.name || "餐廳訂位",
    // Not eventTimeLabel: 「已訂位：餐廳訂位 12:00～13:30」 says it twice.
    description: `已訂位 ${fixedEventInfo(event).startTime}～${fixedEventInfo(event).endTime}`,
    fixedEvent: fixedEventInfo(event),
    ...(venue ? { placeId: venue.placeId, lat: venue.lat, lng: venue.lng, address: venue.address } : {}),
  };
}

/** A day's fixed events as stops plus the blocks the scheduler must keep clear. */
export type DayFixedEvents = Array<{ block: FixedBlock; stop?: Record<string, unknown> }>;

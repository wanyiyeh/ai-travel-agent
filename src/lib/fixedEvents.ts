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

export function eventWindow(event: FixedEvent): { startMinute: number; endMinute: number } {
  const startMinute = minuteOf(event.startTime);
  const endMinute = event.endTime ? minuteOf(event.endTime) : startMinute + FIXED_EVENT_TYPES[event.type].defaultMinutes;
  return { startMinute, endMinute: Math.max(endMinute, startMinute + 15) };
}

/** The trip date (YYYY-MM-DD) of itinerary day `dayNumber` (1-based), counting from the departure date. */
export function dateOfDay(departureDate: string, dayNumber: number): string {
  const d = new Date(`${departureDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayNumber - 1);
  return d.toISOString().slice(0, 10);
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

export function blockOf(event: FixedEvent): FixedBlock {
  return { ...eventWindow(event), ...(isMealEvent(event) ? { meal: true } : {}) };
}

/** What a fixed event is shown as: 「演唱會 18:00～21:00」. */
export function eventTimeLabel(event: FixedEvent): string {
  const { startMinute, endMinute } = eventWindow(event);
  return `${FIXED_EVENT_TYPES[event.type].label} ${hhmm(startMinute)}～${hhmm(endMinute)}`;
}

/** Stored on a stop or meal made from a fixed event, so the UI can pin it and keep 換一個 off it. */
export type FixedEventInfo = { type: FixedEventType; startTime: string; endTime: string };

export function fixedEventInfo(event: FixedEvent): FixedEventInfo {
  const { startMinute, endMinute } = eventWindow(event);
  return { type: event.type, startTime: hhmm(startMinute), endTime: hhmm(endMinute) };
}

export type Venue = { placeId?: string; name: string; lat: number; lng: number; address?: string };

/**
 * The stop a fixed event becomes. `venue` is the looked-up place, or the
 * lodging for work with no place given; without either, the stop keeps the
 * traveler's own wording and has no coordinates.
 */
export function eventStop(event: FixedEvent, venue: Venue | undefined): Record<string, unknown> {
  const { startMinute, endMinute } = eventWindow(event);
  const name = event.venueName?.trim() || venue?.name || (event.type === "work" ? "在住宿工作" : FIXED_EVENT_TYPES[event.type].label);
  return {
    id: crypto.randomUUID(),
    name,
    description: `固定行程：${eventTimeLabel(event)}`,
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

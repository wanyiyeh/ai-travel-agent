export type TimeOfDay = "morning" | "afternoon" | "evening";

/**
 * Splits a day's stops into three even thirds by position (0-indexed) rather
 * than by actual duration/clock time — a placeholder until duration-aware
 * scheduling lands (see plan/hybrid-rule-engine-scheduling.md).
 */
export function assignTimeOfDay(index: number, total: number): TimeOfDay {
  const position = index / total;
  if (position < 1 / 3) return "morning";
  if (position < 2 / 3) return "afternoon";
  return "evening";
}

export type Pace = "relaxed" | "moderate" | "intensive";

export type SchedulableStop = {
  id: string;
  type?: string;
  durationMinutes?: number;
  isMeal?: boolean;
};

export type ScheduledStop = SchedulableStop & {
  time_of_day: TimeOfDay;
  estimatedDurationMinutes: number;
  startMinute: number;
  endMinute: number;
};

export type AssignTimeSlotsOptions = {
  pace?: Pace;
  /** Minutes since midnight the day's first stop can start at. Default 08:00. */
  dayStartMinute?: number;
};

// Default stay length by Places type, minutes — placeholder table per
// plan section 3.3; extend as real candidate data surfaces more types.
const DEFAULT_DURATION_BY_TYPE: Record<string, number> = {
  museum: 90,
  viewpoint: 30,
  temple: 45,
  park: 60,
  shopping: 60,
  landmark: 45,
};
const DEFAULT_DURATION_FALLBACK_MINUTES = 60;
const DEFAULT_MEAL_DURATION_MINUTES = 60;

// Fixed meal windows, minutes since midnight — breakfast/lunch/dinner.
const MEAL_WINDOWS: { startMinute: number; endMinute: number }[] = [
  { startMinute: 7 * 60, endMinute: 9 * 60 },
  { startMinute: 12 * 60, endMinute: 14 * 60 },
  { startMinute: 18 * 60, endMinute: 20 * 60 },
];

const BUFFER_MINUTES_BY_PACE: Record<Pace, number> = {
  relaxed: 30,
  moderate: 15,
  intensive: 5,
};

function classifyTimeOfDay(startMinute: number): TimeOfDay {
  if (startMinute < 12 * 60) return "morning";
  if (startMinute < 18 * 60) return "afternoon";
  return "evening";
}

function estimateDuration(stop: SchedulableStop): number {
  if (typeof stop.durationMinutes === "number") return stop.durationMinutes;
  if (stop.isMeal) return DEFAULT_MEAL_DURATION_MINUTES;
  if (stop.type && stop.type in DEFAULT_DURATION_BY_TYPE) {
    return DEFAULT_DURATION_BY_TYPE[stop.type];
  }
  return DEFAULT_DURATION_FALLBACK_MINUTES;
}

/**
 * Lays already-ordered stops onto a clock timeline, replacing the naive
 * index/total thirds-split above with duration- and pace-aware scheduling
 * (plan/hybrid-rule-engine-scheduling.md, section 3.3). A meal stop snaps
 * forward to the next fixed meal window that hasn't fully passed yet
 * (falling back to the last window if the clock has run past all of them,
 * rather than waiting indefinitely); a non-meal stop's duration comes from
 * `durationMinutes` when known, else a type -> default-duration lookup.
 * `pace` sets the buffer inserted between consecutive stops: relaxed spaces
 * stops out more, intensive packs them tighter. Pure function — selection
 * and ordering of stops happen elsewhere (selectAndOrderStops).
 */
export function assignTimeSlots(
  stops: SchedulableStop[],
  options: AssignTimeSlotsOptions = {}
): ScheduledStop[] {
  const pace = options.pace ?? "moderate";
  const buffer = BUFFER_MINUTES_BY_PACE[pace];
  let cursor = options.dayStartMinute ?? 8 * 60;

  return stops.map((stop) => {
    const duration = estimateDuration(stop);
    let startMinute = cursor;

    if (stop.isMeal) {
      const window =
        MEAL_WINDOWS.find((w) => w.endMinute > cursor) ??
        MEAL_WINDOWS[MEAL_WINDOWS.length - 1];
      startMinute = Math.max(cursor, window.startMinute);
    }

    const endMinute = startMinute + duration;
    cursor = endMinute + buffer;

    return {
      ...stop,
      estimatedDurationMinutes: duration,
      startMinute,
      endMinute,
      time_of_day: classifyTimeOfDay(startMinute),
    };
  });
}

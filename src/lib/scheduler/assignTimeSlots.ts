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
  /**
   * Minutes since midnight the day's last stop should finish by. When given
   * and the packed schedule finishes well before it, the leftover time is
   * spread evenly across the gaps between stops instead of leaving the whole
   * afternoon empty. Omit to keep stops packed back-to-back.
   */
  dayEndMinute?: number;
};

/** When a day's first stop starts unless the caller says otherwise. Trip days pass their own (itineraryCityGen START_TIME_MINUTE). */
const DEFAULT_DAY_START_MINUTE = 8 * 60;

export type DurationCategory = "museum" | "viewpoint" | "temple" | "park" | "shopping" | "landmark";

// Stay length by pace and category, minutes. Pace is defined by how long you
// stay, not how many stops you get (plan/form-preference-wiring.md 1.2):
// intensive keeps every stop to 1.5h or less, moderate gives places about
// 3h. Quick-look categories are stretched too — measured on dev.db's cached
// pools, landmark/temple/viewpoint are ~64% of candidates, so leaving them at
// an hour would make moderate days ~5 stops and blur the pace difference.
// Categories match mapPlaceTypeToCategory.ts's output.
const DURATION_BY_PACE: Record<Pace, Record<DurationCategory, number>> = {
  intensive: { museum: 90, park: 60, shopping: 60, viewpoint: 45, temple: 45, landmark: 45 },
  moderate: { museum: 180, park: 150, shopping: 150, viewpoint: 120, temple: 120, landmark: 120 },
  relaxed: { museum: 210, park: 180, shopping: 180, viewpoint: 150, temple: 150, landmark: 150 },
};
// Unrecognized type — same as the park/shopping row.
const FALLBACK_DURATION_BY_PACE: Record<Pace, number> = {
  intensive: 60,
  moderate: 150,
  relaxed: 180,
};
const DEFAULT_MEAL_DURATION_MINUTES = 60;

// Fixed meal windows, minutes since midnight — breakfast/lunch/dinner.
const MEAL_WINDOWS: { startMinute: number; endMinute: number }[] = [
  { startMinute: 7 * 60, endMinute: 9 * 60 },
  { startMinute: 12 * 60, endMinute: 14 * 60 },
  { startMinute: 18 * 60, endMinute: 20 * 60 },
];

// Attraction-only days (the scheduler's candidate pools are all
// tourist_attraction — meals live separately on day.meals) still need to
// leave room for lunch, or four ~1-hour stops from 08:00 all land before noon
// and every stop comes out "morning" (validateItinerary's STOPS_ALL_SAME_TIME,
// plan/hybrid-rule-engine-scheduling.md 0.10). The hour can start anywhere
// from 11:00 (a late riser's first meal) to 14:00: a fixed 12:00-13:00 pushed
// any stop that touched it to 13:00, so a 3-hour museum from 10:00 left the
// whole morning empty and later stops ran past the day's end.
export const LUNCH = { earliestStartMinute: 11 * 60, latestStartMinute: 14 * 60, durationMinutes: 60 };

// Stops before lunch start before noon and stops after it start after noon,
// so the timeline (which places lunch between morning and afternoon stops)
// shows it where it actually falls.
const NOON_MINUTE = 12 * 60;

// Cap on the extra gap stretching adds between two stops, so a 2-stop day
// isn't spread into two stops five hours apart.
const MAX_STRETCH_MINUTES = 120;
const STRETCH_STEP_MINUTES = 5;

export const BUFFER_MINUTES_BY_PACE: Record<Pace, number> = {
  relaxed: 30,
  moderate: 15,
  intensive: 5,
};

/** Default stay for a (possibly unrecognized) category at a pace — shared with stopCapacity.ts. */
export function typicalStopMinutes(type: string | undefined, pace: Pace): number {
  const byType = type ? DURATION_BY_PACE[pace][type as DurationCategory] : undefined;
  return byType ?? FALLBACK_DURATION_BY_PACE[pace];
}

function classifyTimeOfDay(startMinute: number): TimeOfDay {
  if (startMinute < 12 * 60) return "morning";
  if (startMinute < 18 * 60) return "afternoon";
  return "evening";
}

function estimateDuration(stop: SchedulableStop, pace: Pace): number {
  if (typeof stop.durationMinutes === "number") return stop.durationMinutes;
  if (stop.isMeal) return DEFAULT_MEAL_DURATION_MINUTES;
  // stop.type is a plain string (candidates aren't guaranteed to have run
  // through mapPlaceTypeToCategory), so a lookup miss is expected and falls
  // back to the pace's flat default rather than being a type error.
  return typicalStopMinutes(stop.type, pace);
}

function layOut(
  stops: SchedulableStop[],
  dayStartMinute: number,
  buffer: number,
  pace: Pace
): ScheduledStop[] {
  let lunchDone = stops.some((s) => s.isMeal);
  let cursor = dayStartMinute;

  return stops.map((stop, index) => {
    const duration = estimateDuration(stop, pace);
    // No buffer before the day's first stop — it starts at dayStartMinute.
    let startMinute = index === 0 ? cursor : cursor + buffer;

    if (stop.isMeal) {
      const window =
        MEAL_WINDOWS.find((w) => w.endMinute > startMinute) ??
        MEAL_WINDOWS[MEAL_WINDOWS.length - 1];
      startMinute = Math.max(startMinute, window.startMinute);
    } else if (!lunchDone) {
      if (cursor > LUNCH.latestStartMinute) {
        // The day started after lunchtime (a late arrival).
        lunchDone = true;
      } else if (startMinute >= NOON_MINUTE || startMinute + duration > LUNCH.latestStartMinute) {
        // Too late to start before lunch, or it would end too late to eat after it.
        startMinute = Math.max(cursor, LUNCH.earliestStartMinute) + LUNCH.durationMinutes;
        lunchDone = true;
      }
    }

    const endMinute = startMinute + duration;
    cursor = endMinute;

    return {
      ...stop,
      estimatedDurationMinutes: duration,
      startMinute,
      endMinute,
      time_of_day: classifyTimeOfDay(startMinute),
    };
  });
}

/**
 * Lays already-ordered stops onto a clock timeline, replacing the naive
 * index/total thirds-split above with duration- and pace-aware scheduling
 * (plan/hybrid-rule-engine-scheduling.md, section 3.3). A meal stop snaps
 * forward to the next fixed meal window that hasn't fully passed yet
 * (falling back to the last window if the clock has run past all of them,
 * rather than waiting indefinitely); a non-meal stop's duration comes from
 * `durationMinutes` when known, else a pace + type -> duration lookup.
 * When the stops include no meal of their own, an hour for lunch goes in
 * after the last stop that starts before noon and ends by 14:00 (see LUNCH).
 * `pace` sets both each stop's default stay and the buffer between
 * consecutive stops: relaxed stays longer and spaces stops out more. With `dayEndMinute`, spare
 * time before it is added evenly to every gap (the largest 5-minute step,
 * up to MAX_STRETCH_MINUTES, that still finishes in time). Pure function —
 * selection and ordering of stops happen elsewhere (selectAndOrderStops).
 */
export function assignTimeSlots(
  stops: SchedulableStop[],
  options: AssignTimeSlotsOptions = {}
): ScheduledStop[] {
  const pace = options.pace ?? "moderate";
  const buffer = BUFFER_MINUTES_BY_PACE[pace];
  const dayStartMinute = options.dayStartMinute ?? DEFAULT_DAY_START_MINUTE;

  let scheduled = layOut(stops, dayStartMinute, buffer, pace);
  const { dayEndMinute } = options;
  if (dayEndMinute == null || scheduled.length < 2) return scheduled;

  // End time only ever grows with the extra gap, so the first step that
  // fits, counting down from the cap, is the largest one.
  for (let extra = MAX_STRETCH_MINUTES; extra > 0; extra -= STRETCH_STEP_MINUTES) {
    const stretched = layOut(stops, dayStartMinute, buffer + extra, pace);
    if (stretched[stretched.length - 1].endMinute <= dayEndMinute) {
      scheduled = stretched;
      break;
    }
  }
  return scheduled;
}

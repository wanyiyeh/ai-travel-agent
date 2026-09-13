import { selectAndOrderStops, type StopCandidate } from "@/lib/scheduler/selectAndOrderStops";
import { assignTimeSlots, type Pace, type ScheduledStop } from "@/lib/scheduler/assignTimeSlots";

export type BuildDaySkeletonOptions = {
  /** How many candidates to pick for this day. */
  count: number;
  pace?: Pace;
  /** Starting point for nearest-neighbor ordering, e.g. the day's accommodation. */
  origin?: { lat: number; lng: number };
  /** Multiplier applied to a candidate's score by its `type` — see selectAndOrderStops. */
  interestWeights?: Record<string, number>;
  /** Minutes since midnight the day's first stop can start at. Default 08:00. */
  dayStartMinute?: number;
  /** Candidate `type` values treated as meal stops for time-slot snapping. */
  mealTypes?: string[];
};

export type SkeletonStop = ScheduledStop & { lat: number; lng: number };

const DEFAULT_MEAL_TYPES = ["restaurant", "meal"];

/**
 * Composes selectAndOrderStops + assignTimeSlots into one day's worth of
 * scheduled stops from a single candidate pool — the glue Phase 2's shadow
 * mode needs before it can compare a rule-engine skeleton against the LLM's
 * output for the same candidates (plan/hybrid-rule-engine-scheduling.md).
 * Still pure and DB/API-free: the candidate pool and city/day allocation
 * (planCityBlocks) are supplied by the caller, one day at a time.
 */
export function buildDaySkeleton(
  candidates: StopCandidate[],
  options: BuildDaySkeletonOptions
): SkeletonStop[] {
  const { count, pace, origin, interestWeights, dayStartMinute, mealTypes = DEFAULT_MEAL_TYPES } =
    options;

  const ordered = selectAndOrderStops(candidates, { count, origin, interestWeights });

  const scheduled = assignTimeSlots(
    ordered.map((c) => ({
      id: c.id,
      type: c.type,
      isMeal: c.type != null && mealTypes.includes(c.type),
    })),
    { pace, dayStartMinute }
  );

  // assignTimeSlots preserves input order/length 1:1 (a plain .map), so
  // zipping by index back onto `ordered` is safe and avoids an id lookup.
  return scheduled.map((s, i) => ({ ...s, lat: ordered[i].lat, lng: ordered[i].lng }));
}

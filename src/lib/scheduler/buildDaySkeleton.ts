import { selectAndOrderStops, type StopCandidate } from "@/lib/scheduler/selectAndOrderStops";
import { assignTimeSlots, type FixedBlock, type Pace, type ScheduledStop } from "@/lib/scheduler/assignTimeSlots";
import { keepOutdoorBeforeSunset, keepOutdoorOffMidday } from "@/lib/indoorOutdoor";

export type BuildDaySkeletonOptions = {
  /** How many candidates to pick for this day. */
  count: number;
  pace?: Pace;
  /** Starting point for nearest-neighbor ordering, e.g. the day's accommodation. */
  origin?: { lat: number; lng: number };
  /** Lodging location for distance scoring — see selectAndOrderStops scoreCandidate. */
  anchor?: { lat: number; lng: number };
  /** Multiplier applied to a candidate's score by its `type` — see selectAndOrderStops. */
  interestWeights?: Record<string, number>;
  /** Minutes since midnight the day's first stop can start at. Default 08:00. */
  dayStartMinute?: number;
  /** Minutes since midnight the day's last stop should finish by — see assignTimeSlots. */
  dayEndMinute?: number;
  /** Candidate `type` values treated as meal stops for time-slot snapping. */
  mealTypes?: string[];
  /** For an indoor-first traveler: these stops are moved out of the midday sun (indoorOutdoor.ts). */
  isOutdoor?: (candidate: StopCandidate) => boolean;
  /** Committed time (固定行程) no stop may overlap — see assignTimeSlots. */
  fixedBlocks?: FixedBlock[];
  /** Local sunset (dayConditions.ts): `isOutdoorInDark` stops go first and must end by it. */
  sunsetMinute?: number;
  isOutdoorInDark?: (candidate: StopCandidate) => boolean;
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
  const {
    count,
    pace,
    origin,
    anchor,
    interestWeights,
    dayStartMinute,
    dayEndMinute,
    mealTypes = DEFAULT_MEAL_TYPES,
    isOutdoor,
    fixedBlocks,
    sunsetMinute,
    isOutdoorInDark,
  } = options;

  const routed = selectAndOrderStops(candidates, { count, origin, interestWeights, anchor });
  // assignTimeSlots' own default start when none is given.
  let ordered = isOutdoor ? keepOutdoorOffMidday(routed, isOutdoor, dayStartMinute ?? 8 * 60) : routed;
  const darkEarly =
    sunsetMinute !== undefined && isOutdoorInDark !== undefined && sunsetMinute < (dayEndMinute ?? Number.POSITIVE_INFINITY);
  if (darkEarly) ordered = keepOutdoorBeforeSunset(ordered, isOutdoorInDark);

  const schedule = (stops: StopCandidate[]) =>
    assignTimeSlots(
      stops.map((c) => ({
        id: c.id,
        type: c.type,
        isMeal: c.type != null && mealTypes.includes(c.type),
      })),
      { pace, dayStartMinute, dayEndMinute, fixedBlocks }
    );
  let scheduled = schedule(ordered);
  // An outdoor stop that would still run after dark is dropped; the rest move up.
  if (darkEarly) {
    const lit = ordered.filter((c, i) => !(isOutdoorInDark(c) && scheduled[i].endMinute > sunsetMinute));
    if (lit.length < ordered.length) {
      ordered = lit;
      scheduled = schedule(ordered);
    }
  }

  // assignTimeSlots preserves input order/length 1:1 (a plain .map), so
  // zipping by index back onto `ordered` is safe and avoids an id lookup.
  return scheduled.map((s, i) => ({ ...s, lat: ordered[i].lat, lng: ordered[i].lng }));
}

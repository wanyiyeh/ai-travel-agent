import {
  BUFFER_MINUTES_BY_PACE,
  LUNCH,
  hasLunchBlock,
  typicalStopMinutes,
  type FixedBlock,
  type Pace,
} from "@/lib/scheduler/assignTimeSlots";

// Even at intensive pace a day of 8+ stops (~53 min each on real pools)
// leaves no room to eat or rest — plan/form-preference-wiring.md 1.2 caps it.
export const MAX_STOPS_PER_DAY = 6;

export type StopCapacityOptions = {
  pace: Pace;
  dayStartMinute: number;
  dayEndMinute: number;
  /** Categories of the candidates this day will pick from; their average stay sets the per-stop cost. */
  candidateTypes: (string | undefined)[];
  /** Committed time (固定行程) that isn't available for stops. */
  fixedBlocks?: FixedBlock[];
};

/**
 * How many stops plausibly fit between dayStartMinute and dayEndMinute at a
 * pace — replaces the old fixed 4-per-day, so a slower pace gets fewer,
 * longer stops. An estimate for how many candidates to select: the caller
 * still trims any scheduled stop that actually ends past dayEndMinute,
 * since the lunch-break push in assignTimeSlots can waste more than the
 * hour subtracted here.
 */
export function estimateStopCapacity({
  pace,
  dayStartMinute,
  dayEndMinute,
  candidateTypes,
  fixedBlocks = [],
}: StopCapacityOptions): number {
  // assignTimeSlots takes the lunch hour unless the day starts after its
  // latest start — or a lunch reservation already covers it.
  const lunch = dayStartMinute <= LUNCH.latestStartMinute && !hasLunchBlock(fixedBlocks) ? LUNCH.durationMinutes : 0;
  const blocked = fixedBlocks.reduce(
    (sum, b) => sum + Math.max(0, Math.min(dayEndMinute, b.endMinute) - Math.max(dayStartMinute, b.startMinute)),
    0
  );
  const available = dayEndMinute - dayStartMinute - lunch - blocked;
  if (available <= 0) return 0;

  const durations = candidateTypes.length > 0
    ? candidateTypes.map((t) => typicalStopMinutes(t, pace))
    : [typicalStopMinutes(undefined, pace)];
  const average = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  const buffer = BUFFER_MINUTES_BY_PACE[pace];

  // n stops need n stays and n - 1 buffers: n * (avg + buffer) - buffer <= available.
  const count = Math.floor((available + buffer) / (average + buffer));
  return Math.max(0, Math.min(MAX_STOPS_PER_DAY, count));
}

import type { SkeletonStop } from "@/lib/scheduler/buildDaySkeleton";

// A rule-engine day's per-stop line, by stop id. Written from the schedule
// alone, never from the place: no Google Maps content may go into text we
// create (ADR-0008), and the list already shows each stop's name, duration
// and the way there, with Google's own details a tap away. So most stops get
// no line; only where the day starts its theme and where it ends.

/** Description by skeleton stop id; a stop not listed gets none. */
export type StopCopy = Record<string, string>;

/** The day's first stop on a themed day: 「今天的文化巡禮從這裡開始。」 */
export const themeStartNote = (themeLabel: string) => `今天的${themeLabel}從這裡開始。`;
export const LAST_STOP_NOTE = "今天的最後一站。";

/**
 * Lines for a sightseeing day: the theme's start on the first stop when the
 * day has a theme, and the last stop marked when `markLast` (a full day; a
 * transit or departure day goes on to travel). Pure and synchronous.
 */
export function buildStopCopy(
  skeleton: SkeletonStop[],
  { themeLabel, markLast = false }: { themeLabel?: string; markLast?: boolean } = {}
): StopCopy {
  const copy: StopCopy = {};
  if (skeleton.length === 0) return copy;
  if (themeLabel) copy[skeleton[0].id] = themeStartNote(themeLabel);
  if (markLast && skeleton.length > 1) copy[skeleton[skeleton.length - 1].id] = LAST_STOP_NOTE;
  return copy;
}

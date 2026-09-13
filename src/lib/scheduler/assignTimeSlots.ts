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

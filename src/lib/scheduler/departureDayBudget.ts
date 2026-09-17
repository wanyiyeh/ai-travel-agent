export type DepartureDayBudget = {
  cutoffMinute: number;
  estimatedCount: number;
};

// Mirrors buildSystemPrompt's existing "at least 3 hours before the return
// flight" rule (itineraryGen.ts buildFlightTimePrompt) — a real check-in/
// security buffer, not a placeholder.
const DEPARTURE_BUFFER_MINUTES = 3 * 60;

// No returnDepartureTime (FlightInfoSchema field is optional) — assume a
// conservative half-day rather than generating nothing.
const DEFAULT_DEPARTURE_CUTOFF_MINUTE = 14 * 60;

// Same duration+buffer heuristic scale as assignTimeSlots' moderate-pace
// buffer + a typical attraction's default duration — rough, not precise (see
// plan/hybrid-rule-engine-scheduling.md section 7 on duration estimates being
// approximate throughout this project, not just here).
const AVG_STOP_BLOCK_MINUTES = 90;
const MAX_DEPARTURE_STOPS = 3;

/**
 * How many attraction stops plausibly fit into a trip's last morning/early
 * afternoon before the traveler needs to head to the airport — pure clock
 * arithmetic, no LLM judgment needed (unlike a transit day's arrival-activity
 * count, which depends on real-world inter-city distance knowledge an LLM
 * has and this project has no rule-engine data source for). The caller
 * (generateDepartureDayStops, itineraryCityGen.ts) still filters the actual
 * scheduled stops by `cutoffMinute` afterward — this count is just a
 * starting estimate for how many candidates to select.
 */
export function computeDepartureDayBudget(
  returnDepartureMinute: number | undefined,
  dayStartMinute = 8 * 60
): DepartureDayBudget {
  const cutoffMinute =
    returnDepartureMinute != null
      ? returnDepartureMinute - DEPARTURE_BUFFER_MINUTES
      : DEFAULT_DEPARTURE_CUTOFF_MINUTE;

  const availableMinutes = cutoffMinute - dayStartMinute;
  const estimatedCount =
    availableMinutes <= 0 ? 0 : Math.min(MAX_DEPARTURE_STOPS, Math.floor(availableMinutes / AVG_STOP_BLOCK_MINUTES));

  return { cutoffMinute, estimatedCount };
}

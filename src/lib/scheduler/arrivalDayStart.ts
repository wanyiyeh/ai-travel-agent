// Mirrors departureDayBudget.ts's symmetry: the trip's actual first day
// (flight arrival) shouldn't start at the usual 08:00 default — the old
// mega-prompt already requires "day 1 must start a reasonable time after
// arrival" (itineraryGen.ts buildFlightTimePrompt). This buffer covers
// immigration, baggage claim, and transit into the city — approximate, not
// precise (see plan/hybrid-rule-engine-scheduling.md section 7 on duration
// estimates being approximate throughout this project).
const ARRIVAL_BUFFER_MINUTES = 90;

// No arrivalTime given (FlightInfoSchema field is optional) — a reasonable
// late-morning start rather than assuming the traveler is free at 08:00.
const DEFAULT_ARRIVAL_DAY_START_MINUTE = 10 * 60;

/**
 * What minute the trip's very first day's schedule should start at — passed
 * as generateDayStops' firstDayStartMinute for the first city's first day
 * only (assembleItineraryDays.ts). Every other day keeps its own default;
 * this only concerns the literal start of the whole trip.
 */
export function computeArrivalDayStartMinute(arrivalMinute: number | undefined): number {
  if (arrivalMinute == null) return DEFAULT_ARRIVAL_DAY_START_MINUTE;
  return arrivalMinute + ARRIVAL_BUFFER_MINUTES;
}

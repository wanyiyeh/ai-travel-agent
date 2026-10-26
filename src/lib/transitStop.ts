/**
 * A transit day's ride between cities (ADR-0009). It sits in `stops` so the
 * day reads in order, but it is a leg, not a place: no placeId, no
 * coordinates, not draggable, and the transport around it is computed across
 * it rather than to it.
 */

type StopLike = { kind?: unknown; name?: unknown; placeId?: unknown; fixedEvent?: unknown };
type DayLike = { isTransitDay?: unknown };

export const TRANSIT_STOP_KIND = "transit";

/**
 * Stops written before `kind` existed are recognised by shape: on a transit
 * day, with no place behind them, named like 「搭乘新幹線前往京都」 — what
 * planTransitDay's prompt and islandHopPlan both write.
 */
export function isTransitStop(stop: StopLike, day: DayLike): boolean {
  if (stop.kind === TRANSIT_STOP_KIND) return true;
  return (
    day.isTransitDay === true &&
    !stop.placeId &&
    !stop.fixedEvent &&
    typeof stop.name === "string" &&
    stop.name.includes("前往")
  );
}

/** Index of the day's transit stop, or -1 when it has none. */
export function transitStopIndex(stops: readonly StopLike[], day: DayLike): number {
  return stops.findIndex((stop) => isTransitStop(stop, day));
}

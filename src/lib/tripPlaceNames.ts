type DayLike = { isTransitDay?: unknown; transitTo?: unknown; stops?: unknown };

const isName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/**
 * Names of the places a trip already goes to, for leaving them out of the
 * nearby-city recommendations: the cities moved to, and the stops — day trips
 * like Wieliczka from Kraków are only a stop, never a transit day. A Google
 * place is saved without its name (ADR-0004), so only our own names are here;
 * sending its missing one made the whole request invalid (#324).
 */
export function tripPlaceNames(days: readonly DayLike[]): string[] {
  const cities = days.filter((d) => d.isTransitDay === true).map((d) => d.transitTo);
  const stops = days.flatMap((d) =>
    Array.isArray(d.stops) ? d.stops.map((s) => (s as { name?: unknown } | null)?.name) : []
  );
  return [...cities, ...stops].filter(isName);
}

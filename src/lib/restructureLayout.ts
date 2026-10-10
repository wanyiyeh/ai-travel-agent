// Where days land after 重新規劃, shared by the wizard (RestructurePanel.tsx,
// for its warnings) and the route that applies it (restructure/route.ts), so
// what the wizard shows is what the route does. No server imports: the
// wizard ships this to the browser.

export type LayoutCity = { isNew: boolean; targetDays: number; keepDayIds: string[] };

/**
 * The trip day number each city's block starts on. Blocks follow each other
 * in order, except that the old return day moves to the very end when its
 * city is no longer the last, so every block after that city starts a day
 * earlier.
 */
export function blockStartDays(cities: LayoutCity[], lastOriginalDayId: string | undefined): number[] {
  const returnBlock = cities.findIndex(
    (c) => !c.isNew && lastOriginalDayId !== undefined && c.keepDayIds.includes(lastOriginalDayId)
  );
  const movesReturnDay = returnBlock !== -1 && returnBlock < cities.length - 1;
  return cities.map(
    (_, idx) =>
      1 + cities.slice(0, idx).reduce((sum, c) => sum + c.targetDays, 0) - (movesReturnDay && idx > returnBlock ? 1 : 0)
  );
}

/**
 * The day number a kept sightseeing day of an existing city ends up on. The
 * block opens with a transit day when the city before it is new, then has
 * its kept sightseeing days in their original order (restructure/route.ts
 * buildCityBlock). Undefined when the day isn't kept as a sightseeing day.
 */
export function keptSightseeingDayNumber(
  cities: LayoutCity[],
  cityIdx: number,
  dayId: string,
  isStructural: (dayId: string) => boolean,
  lastOriginalDayId: string | undefined
): number | undefined {
  const city = cities[cityIdx];
  const sightseeing = city.keepDayIds.filter((id) => !isStructural(id));
  const position = sightseeing.indexOf(dayId);
  if (city.isNew || position === -1) return undefined;
  const leadingIn = cityIdx > 0 && cities[cityIdx - 1].isNew ? 1 : 0;
  return blockStartDays(cities, lastOriginalDayId)[cityIdx] + leadingIn + position;
}

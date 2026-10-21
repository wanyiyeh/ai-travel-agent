/**
 * Browser side of ADR-0004: an itinerary arrives with names only for the
 * days the page asked for (GET /api/v1/itinerary/[id]?days=…). The page keeps
 * the names it has been given for this visit, keyed by place ID, and fills
 * them into the days it shows. Nothing here outlives the page.
 */

export type PlaceName = { name: string; address?: string; displayUnavailable?: boolean };
export type PlaceNameBook = Record<string, PlaceName>;

type Rec = Record<string, unknown>;

function itemsOf(day: Rec): Rec[] {
  const items: Rec[] = [];
  if (Array.isArray(day.stops)) items.push(...(day.stops as Rec[]));
  if (day.meals && typeof day.meals === "object") {
    for (const meal of Object.values(day.meals as Rec)) if (meal && typeof meal === "object") items.push(meal as Rec);
  }
  if (day.accommodation && typeof day.accommodation === "object") items.push(day.accommodation as Rec);
  return items;
}

function lacksName(item: Rec): boolean {
  return typeof item.placeId === "string" && typeof item.name !== "string";
}

/** Day numbers with a place still waiting for its name. */
export function daysMissingNames(days: readonly unknown[]): number[] {
  return (days as Rec[])
    .filter((d) => d && typeof d === "object" && itemsOf(d).some(lacksName))
    .map((d) => d.day as number);
}

/** Names the server filled in, by place ID, to remember for this visit. */
export function collectPlaceNames(days: readonly unknown[]): PlaceNameBook {
  const book: PlaceNameBook = {};
  for (const day of days as Rec[]) {
    if (!day || typeof day !== "object") continue;
    for (const item of itemsOf(day)) {
      if (typeof item.placeId !== "string" || typeof item.name !== "string") continue;
      book[item.placeId] = {
        name: item.name,
        ...(typeof item.address === "string" ? { address: item.address } : {}),
        ...(item.displayUnavailable ? { displayUnavailable: true } : {}),
      };
    }
  }
  return book;
}

function fill<T>(item: T, book: PlaceNameBook): T {
  const rec = item as unknown as Rec;
  if (!rec || typeof rec !== "object" || !lacksName(rec)) return item;
  const known = book[rec.placeId as string];
  return known ? ({ ...rec, ...known } as T) : item;
}

/**
 * The days with every place the book knows filled in. Returns new objects
 * only where something changed, so it's cheap to run on each update and
 * never touches edits already in `days`.
 */
export function withPlaceNames<T>(days: T[], book: PlaceNameBook): T[] {
  if (Object.keys(book).length === 0) return days;
  return days.map((day) => {
    const d = day as unknown as Rec;
    if (!d || typeof d !== "object" || !itemsOf(d).some(lacksName)) return day;
    const next: Rec = { ...d };
    if (Array.isArray(d.stops)) next.stops = (d.stops as unknown[]).map((s) => fill(s, book));
    if (d.meals && typeof d.meals === "object") {
      next.meals = Object.fromEntries(Object.entries(d.meals as Rec).map(([slot, meal]) => [slot, fill(meal, book)]));
    }
    if (d.accommodation) next.accommodation = fill(d.accommodation, book);
    return next as T;
  });
}

// 跟團去 (plan/form-preference-wiring.md 1.5): where a day goes somewhere
// people often visit on a tour — 日光 as a day trip, 賞楓, Auschwitz with a
// guide — a link to that place's tours on KKday and Klook. Plain search
// links: neither has a public API (their partner programs do; affiliate
// tracking could be added to these links later), and fetching their pages
// would break their terms. No call is made, so it costs nothing.

export type TourLink = { site: string; url: string };

const SITES: { site: string; search: (keyword: string) => string }[] = [
  { site: "KKday", search: (k) => `https://www.kkday.com/zh-tw/product/productlist?keyword=${encodeURIComponent(k)}` },
  { site: "Klook", search: (k) => `https://www.klook.com/zh-TW/search/result/?query=${encodeURIComponent(k)}` },
];

export function tourLinks(keyword: string): TourLink[] {
  return SITES.map(({ site, search }) => ({ site, url: search(keyword) }));
}

// A sight people spend half a day at (a big museum, a memorial site) is
// where a guided tour is most worth it.
const BIG_SIGHT_MINUTES = 180;

/** A sight long enough that a guided tour is worth suggesting; not a booked event. */
export function isBigSight(stop: { duration_minutes?: number; placeId?: string; fixedEvent?: unknown }): boolean {
  return Boolean(stop.placeId) && !stop.fixedEvent && (stop.duration_minutes ?? 0) >= BIG_SIGHT_MINUTES;
}

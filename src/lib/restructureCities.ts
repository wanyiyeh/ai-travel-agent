import { MAX_CITY_DAYS } from "@/lib/inputLimits";

// How 重新規劃 sees a trip: its days grouped into city blocks, and which of
// each city's days stay when its day count changes. Pure functions shared by
// the wizard (RestructurePanel.tsx) and the chat assistant's restructure
// proposals (src/lib/chat/restructureProposal.ts, ADR-0014); what they
// produce is restructure/route.ts's request.

export const PRIMARY_CITY_KEY = "__primary__";
export const MAX_TARGET_DAYS = MAX_CITY_DAYS;

export interface RestructureDayLite {
  id: string;
  day: number;
  theme?: string;
  isTransitDay?: boolean;
  isLocked?: boolean;
  waypointCity?: string;
  stopCount: number;
  /** The traveler's booked event that day (固定行程), 「演唱會 11/12」: the day is always kept. */
  bookedEventLabel?: string;
  /** Its date on the ticket, 2026-11-12: warned about if the day moves off it. */
  bookedEventDate?: string;
}

export interface LockedAttractionState {
  key: string;
  name: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  address?: string;
  rating?: number | null;
  photoName?: string | null;
  priceLevel?: number | null;
}

export interface CityEntryState {
  key: string;
  name: string;
  isNew: boolean;
  existingDayIds: string[]; // original day order — empty for new cities
  structuralDayIds: Set<string>; // transit-out / trip-return days — always kept
  bookedDayIds: Set<string>; // sightseeing days with a booked event (固定行程) — always kept too
  keepDayIds: Set<string>;
  touchedKeep: boolean;
  targetDays: number; // total days for this city, including structural days
  lockedAttractions: LockedAttractionState[];
  fromRecommendation: boolean; // added via the 周邊推薦 cards, counts against the insertion cap
  // Transit days that move with the neighbours (relinkCities): an existing
  // city right after a new one gains a leading transit day from it, and one
  // right before a new one loses its own outbound day — the new city's
  // leading day replaces it.
  hasOutboundTransit: boolean;
  leadingTransit: boolean;
  outboundReplaced: boolean;
  lat?: number; // used only to place a newly-added city near its geographic
  lng?: number; // neighbor — see findInsertionIndex
}

// A transit day or the trip's very last day doesn't represent a day actually
// spent sightseeing in its assigned city — mirrors isStructuralDay in the
// restructure API route.
export function computeStructuralDayIds(days: RestructureDayLite[]): Set<string> {
  const ids = new Set(days.filter((d) => d.isTransitDay).map((d) => d.id));
  const last = days[days.length - 1];
  if (last) ids.add(last.id);
  return ids;
}

export function groupExistingDays(days: RestructureDayLite[], structuralIds: Set<string>): CityEntryState[] {
  const buckets = new Map<string, RestructureDayLite[]>();
  for (const day of days) {
    const key = day.waypointCity || PRIMARY_CITY_KEY;
    const list = buckets.get(key) ?? [];
    list.push(day);
    buckets.set(key, list);
  }
  return Array.from(buckets.entries()).map(([key, bucketDays]) => {
    const ids = bucketDays.map((d) => d.id);
    const cityStructuralIds = new Set(ids.filter((id) => structuralIds.has(id)));
    const bookedIds = bucketDays.filter((d) => d.bookedEventLabel && !structuralIds.has(d.id)).map((d) => d.id);
    const hasOutboundTransit = bucketDays.some((d) => d.isTransitDay);
    return {
      key: crypto.randomUUID(),
      name: key === PRIMARY_CITY_KEY ? "" : key,
      isNew: false,
      existingDayIds: ids,
      structuralDayIds: cityStructuralIds,
      bookedDayIds: new Set(bookedIds),
      keepDayIds: new Set(ids),
      touchedKeep: false,
      targetDays: ids.length,
      lockedAttractions: [],
      fromRecommendation: false,
      hasOutboundTransit,
      leadingTransit: false,
      outboundReplaced: false,
    };
  });
}

/**
 * After cities are added, removed or moved: which existing cities gain a
 * leading transit day (the city before is new) or lose their outbound one
 * (the city after is new), as restructure/route.ts builds them. The city's
 * day count moves with it, so every existing day stays: inserting 名古屋
 * between 東京 and 京都 takes 東京's day to 京都 off 東京 and gives 京都 its
 * day from 名古屋. Without this, 京都 silently lost a day and 東京 got an AI day.
 */
export function relinkCities(cities: CityEntryState[]): CityEntryState[] {
  return cities.map((c, idx) => {
    if (c.isNew) return c;
    const leadingTransit = idx > 0 && cities[idx - 1].isNew;
    const outboundReplaced = c.hasOutboundTransit && idx < cities.length - 1 && cities[idx + 1].isNew;
    const delta = (Number(leadingTransit) - Number(c.leadingTransit)) - (Number(outboundReplaced) - Number(c.outboundReplaced));
    if (delta === 0 && leadingTransit === c.leadingTransit && outboundReplaced === c.outboundReplaced) return c;
    const relinked = { ...c, leadingTransit, outboundReplaced };
    return syncKeepDaysForTarget({ ...relinked, targetDays: Math.max(minCityDays(relinked), Math.min(MAX_TARGET_DAYS, c.targetDays + delta)) });
  });
}

// Number of structural (transit/return) days baked into a city's targetDays:
// a new city always has exactly 1 (its leading transit day); an existing
// city has however many of its kept days are structural, plus a leading
// transit day from a new city before it, less an outbound day a new city
// after it replaces (relinkCities).
function structuralCount(city: CityEntryState): number {
  if (city.isNew) return 1;
  return city.structuralDayIds.size + (city.leadingTransit ? 1 : 0) - (city.outboundReplaced ? 1 : 0);
}

// Total days actually spent on this city block. `targetDays` is the total
// the user sets and sees directly — what you set is what you get — so this
// is just an alias kept for readability at call sites.
export function totalCityDays(city: CityEntryState): number {
  return city.targetDays;
}

// The fewest days a city can have: its structural days, its locked
// attractions and its booked-event days, none of which can be dropped.
export function minCityDays(city: CityEntryState): number {
  return Math.max(1, city.lockedAttractions.length + structuralCount(city) + city.bookedDayIds.size);
}

// How many existing sightseeing days fit in the city's new total.
function keepCap(city: CityEntryState): number {
  return Math.max(0, city.targetDays - structuralCount(city) - city.lockedAttractions.length);
}

// Booked-event days first: they're kept whatever else has to go.
function bookedFirst(city: CityEntryState, ids: string[]): string[] {
  return [...ids.filter((id) => city.bookedDayIds.has(id)), ...ids.filter((id) => !city.bookedDayIds.has(id))];
}

export function defaultKeepIds(city: CityEntryState): Set<string> {
  const sightseeingIds = bookedFirst(city, city.existingDayIds.filter((id) => !city.structuralDayIds.has(id)));
  return new Set([...sightseeingIds.slice(0, keepCap(city)), ...city.structuralDayIds]);
}

// Reconciles keepDayIds against `city`'s (already-updated) targetDays and
// lockedAttractions. Untouched cities just get the recommended keep list
// recomputed. A touched city's manual picks are preserved as-is UNLESS the
// new, lower targetDays no longer has room for all of them — in that case
// the excess manually-kept sightseeing days (latest-first) are dropped so
// the actual day count restructure will produce can never exceed what this
// panel displays. Without this, shrinking a city after hand-picking which
// days to keep silently produced more days than targetDays, pushing the
// trip over its original total.
export function syncKeepDaysForTarget(city: CityEntryState): CityEntryState {
  if (!city.touchedKeep) return { ...city, keepDayIds: defaultKeepIds(city) };
  const sightseeingKeepOrder = bookedFirst(
    city,
    city.existingDayIds.filter((id) => !city.structuralDayIds.has(id) && city.keepDayIds.has(id))
  );
  const cap = keepCap(city);
  if (sightseeingKeepOrder.length <= cap) return city;
  return {
    ...city,
    keepDayIds: new Set([...sightseeingKeepOrder.slice(0, cap), ...city.structuralDayIds]),
  };
}

// What applying will do to one city: which existing days stay or go, and how
// many new days the AI plans.
export function computeCityDiff(city: CityEntryState) {
  const removed = city.existingDayIds.filter((id) => !city.keepDayIds.has(id));
  // The outbound day a new city's own transit day replaces isn't kept either.
  const keptCount = city.existingDayIds.length - removed.length - (city.outboundReplaced ? 1 : 0);
  const sightseeingKeptCount = city.existingDayIds.filter(
    (id) => city.keepDayIds.has(id) && !city.structuralDayIds.has(id)
  ).length;
  const addedAiDays = Math.max(
    0,
    city.targetDays - structuralCount(city) - sightseeingKeptCount - city.lockedAttractions.length
  );
  return { removed, keptCount, sightseeingKeptCount, addedAiDays };
}

// Existing sightseeing days the traveler could choose between — the cities
// that get the 「進階：手動選擇要保留哪幾天」 section.
export function choosableDayIds(city: CityEntryState): string[] {
  return city.isNew ? [] : city.existingDayIds.filter((id) => !city.structuralDayIds.has(id));
}


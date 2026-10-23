import type { PrismaClient } from "@prisma/client";
import { COORDS_MAX_AGE_MS, isCompliantPlaceStorage } from "@/lib/placeStorage";

/**
 * Deletes Google coordinates older than COORDS_MAX_AGE_MS (ADR-0006): from
 * every itinerary, the trash, candidate history and the Place table. Only
 * the coordinates go; the place keeps its ID, and the next time its day is
 * shown placeDisplay.ts fetches them again.
 *
 * Coordinates with no fetch time are treated as expired: they were stored
 * before times were recorded. Only items with a place ID are touched; a stop
 * without one (an airport, a train ride) has coordinates that are ours.
 *
 * Takes a plain PrismaClient so a script (no Next.js module graph) can run
 * it; JSON columns are handled as strings or parsed objects alike.
 */

type Rec = Record<string, unknown>;

const PAGE_SIZE = 200;

export interface PurgeResult {
  itineraries: number;
  deletedStops: number;
  deletedDays: number;
  candidateLogs: number;
  places: number;
}

function isRec(value: unknown): value is Rec {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Drops one place item's coordinates if they're expired; true when it changed. */
export function dropExpiredCoords(item: unknown, cutoff: number): boolean {
  if (!isRec(item) || typeof item.placeId !== "string") return false;
  if (item.lat == null && item.lng == null) return false;
  const fetchedAt = typeof item.coordsFetchedAt === "string" ? Date.parse(item.coordsFetchedAt) : NaN;
  if (fetchedAt >= cutoff) return false;
  delete item.lat;
  delete item.lng;
  delete item.coordsFetchedAt;
  return true;
}

/** The same walk as stripDay (placeStorage.ts): stops, meals, lodging and the days kept for undo. */
export function dropExpiredDayCoords(day: unknown, cutoff: number): boolean {
  if (!isRec(day)) return false;
  let changed = false;
  if (Array.isArray(day.stops)) for (const stop of day.stops) changed = dropExpiredCoords(stop, cutoff) || changed;
  if (isRec(day.meals)) for (const meal of Object.values(day.meals)) changed = dropExpiredCoords(meal, cutoff) || changed;
  changed = dropExpiredCoords(day.accommodation, cutoff) || changed;
  if (Array.isArray(day._originalAfter)) {
    for (const kept of day._originalAfter) changed = dropExpiredDayCoords(kept, cutoff) || changed;
  }
  return changed;
}

function dropExpiredListCoords(list: unknown, cutoff: number, each: (item: unknown, cutoff: number) => boolean): boolean {
  if (!Array.isArray(list)) return false;
  let changed = false;
  for (const item of list) changed = each(item, cutoff) || changed;
  return changed;
}

/** The column rewritten as a JSON string, or null when nothing in it expired. */
function rewrite(value: unknown, drop: (parsed: unknown) => boolean): string | null {
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
  return drop(parsed) ? JSON.stringify(parsed) : null;
}

/** Every row of a table, a page at a time, ordered by id. */
async function* pages<T extends { id: string }>(fetchPage: (afterId: string) => Promise<T[]>): AsyncGenerator<T> {
  let afterId = "";
  for (;;) {
    const rows = await fetchPage(afterId);
    yield* rows;
    if (rows.length < PAGE_SIZE) return;
    afterId = rows[rows.length - 1].id;
  }
}

/**
 * Runs the purge. Returns null without touching anything unless
 * COMPLIANT_PLACE_STORAGE=1: with it off, writes don't record fetch times, so
 * every coordinate would read as expired.
 */
export async function purgeExpiredCoords(prisma: PrismaClient, now = new Date()): Promise<PurgeResult | null> {
  if (!isCompliantPlaceStorage()) return null;
  const cutoff = now.getTime() - COORDS_MAX_AGE_MS;
  const page = { take: PAGE_SIZE, orderBy: { id: "asc" as const } };
  const result: PurgeResult = { itineraries: 0, deletedStops: 0, deletedDays: 0, candidateLogs: 0, places: 0 };

  for await (const row of pages((afterId) =>
    prisma.itinerary.findMany({ ...page, where: { id: { gt: afterId } }, select: { id: true, days: true, updatedAt: true } }),
  )) {
    const days = rewrite(row.days, (d) => dropExpiredListCoords(d, cutoff, dropExpiredDayCoords));
    if (days === null) continue;
    // Skipped if the traveler saved in between; the next run gets it. The
    // purge isn't an edit, so updatedAt stays.
    const { count } = await prisma.itinerary.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { days, updatedAt: row.updatedAt },
    });
    result.itineraries += count;
  }

  for await (const row of pages((afterId) =>
    prisma.deletedStop.findMany({ ...page, where: { id: { gt: afterId } }, select: { id: true, stop: true } }),
  )) {
    const stop = rewrite(row.stop, (s) => dropExpiredCoords(s, cutoff));
    if (stop === null) continue;
    await prisma.deletedStop.update({ where: { id: row.id }, data: { stop } });
    result.deletedStops++;
  }

  for await (const row of pages((afterId) =>
    prisma.deletedDay.findMany({ ...page, where: { id: { gt: afterId } }, select: { id: true, day: true } }),
  )) {
    const day = rewrite(row.day, (d) => dropExpiredDayCoords(d, cutoff));
    if (day === null) continue;
    await prisma.deletedDay.update({ where: { id: row.id }, data: { day } });
    result.deletedDays++;
  }

  const dropCandidates = (c: unknown) => dropExpiredListCoords(c, cutoff, dropExpiredCoords);
  for await (const row of pages((afterId) =>
    prisma.stopCandidateLog.findMany({ ...page, where: { id: { gt: afterId } }, select: { id: true, candidates: true } }),
  )) {
    const candidates = rewrite(row.candidates, dropCandidates);
    if (candidates === null) continue;
    await prisma.stopCandidateLog.update({ where: { id: row.id }, data: { candidates } });
    result.candidateLogs++;
  }
  for await (const row of pages((afterId) =>
    prisma.mealCandidateLog.findMany({ ...page, where: { id: { gt: afterId } }, select: { id: true, candidates: true } }),
  )) {
    const candidates = rewrite(row.candidates, dropCandidates);
    if (candidates === null) continue;
    await prisma.mealCandidateLog.update({ where: { id: row.id }, data: { candidates } });
    result.candidateLogs++;
  }
  for await (const row of pages((afterId) =>
    prisma.accommodationCandidateLog.findMany({ ...page, where: { id: { gt: afterId } }, select: { id: true, candidates: true } }),
  )) {
    const candidates = rewrite(row.candidates, dropCandidates);
    if (candidates === null) continue;
    await prisma.accommodationCandidateLog.update({ where: { id: row.id }, data: { candidates } });
    result.candidateLogs++;
  }

  const places = await prisma.place.updateMany({
    where: {
      OR: [
        { coordsFetchedAt: { lt: new Date(cutoff) } },
        { coordsFetchedAt: null, OR: [{ lat: { not: null } }, { lng: { not: null } }] },
      ],
    },
    data: { lat: null, lng: null, coordsFetchedAt: null },
  });
  result.places = places.count;

  return result;
}

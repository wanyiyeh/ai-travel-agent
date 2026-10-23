import type { PrismaClient } from "@prisma/client";
import { dropExpiredCoords, purgeExpiredCoords } from "@/lib/coordsPurge";
import { COORDS_MAX_AGE_MS, stripAccommodation, stripCandidates, stripDay, stripDays, stripMeal, stripStop } from "@/lib/placeStorage";

/**
 * Finds and removes Google content the terms don't let us keep (ADR-0004):
 * names, addresses, ratings, photos and other fields outside the
 * placeStorage.ts allowlists, coordinates past 30 days (ADR-0006), the
 * legacy Place columns, and rows of the cache tables that held candidate
 * pools, stations and routes (#203). Writes have been stripped since #206;
 * this is for what was stored before, and the audit proves the result.
 *
 * Takes a plain PrismaClient so scripts can run it; JSON columns are read as
 * strings or parsed objects alike.
 */

type Rec = Record<string, unknown>;
type Strip = (item: unknown) => unknown;

const PAGE_SIZE = 200;

function isRec(value: unknown): value is Rec {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parse(value: unknown): unknown {
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return undefined;
  }
}

/** A field the allowlist would drop: Google content. coordsFetchedAt is added by stripping, never dropped. */
function hasGoogleFields(item: unknown, strip: Strip): boolean {
  if (!isRec(item)) return false;
  const kept = strip(item);
  return isRec(kept) && Object.keys(item).some((key) => !(key in kept));
}

function hasExpiredCoords(item: unknown, cutoff: number): boolean {
  return isRec(item) && dropExpiredCoords({ ...item }, cutoff);
}

/** Every place item of a day with the allowlist it's held to: stops, meals, lodging, and the days kept for undo. */
function placeItemsOfDay(day: unknown): [unknown, Strip][] {
  if (!isRec(day)) return [];
  const items: [unknown, Strip][] = [];
  if (Array.isArray(day.stops)) for (const stop of day.stops) items.push([stop, stripStop]);
  if (isRec(day.meals)) for (const meal of Object.values(day.meals)) items.push([meal, stripMeal]);
  if (day.accommodation) items.push([day.accommodation, stripAccommodation]);
  if (Array.isArray(day._originalAfter)) for (const kept of day._originalAfter) items.push(...placeItemsOfDay(kept));
  return items;
}

const stripCandidate: Strip = (c) => (stripCandidates([c]) as unknown[])[0];

/** What a stored JSON column holds, as place items with their allowlists. */
type ColumnShape = "days" | "day" | "stop" | "candidates";

function placeItems(value: unknown, shape: ColumnShape): [unknown, Strip][] {
  const parsed = parse(value);
  switch (shape) {
    case "days":
      return Array.isArray(parsed) ? parsed.flatMap(placeItemsOfDay) : [];
    case "day":
      return placeItemsOfDay(parsed);
    case "stop":
      return [[parsed, stripStop]];
    case "candidates":
      return Array.isArray(parsed) ? parsed.map((c): [unknown, Strip] => [c, stripCandidate]) : [];
  }
}

const STRIPPERS: Record<ColumnShape, Strip> = { days: stripDays, day: stripDay, stop: stripStop, candidates: stripCandidates };

export interface ColumnFindings {
  googleFields: number;
  expiredCoords: number;
}

/** How many rows of one JSON column hold Google fields, and how many hold expired coordinates. */
export function auditColumn(values: unknown[], shape: ColumnShape, cutoff: number): ColumnFindings {
  const findings: ColumnFindings = { googleFields: 0, expiredCoords: 0 };
  for (const value of values) {
    const items = placeItems(value, shape);
    if (items.some(([item, strip]) => hasGoogleFields(item, strip))) findings.googleFields++;
    if (items.some(([item]) => hasExpiredCoords(item, cutoff))) findings.expiredCoords++;
  }
  return findings;
}

/** The column with Google fields stripped, as a JSON string, or null when it has none. */
export function cleanColumn(value: unknown, shape: ColumnShape): string | null {
  if (!placeItems(value, shape).some(([item, strip]) => hasGoogleFields(item, strip))) return null;
  return JSON.stringify(STRIPPERS[shape](parse(value)));
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

async function collect<T extends { id: string }>(fetchPage: (afterId: string) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for await (const row of pages(fetchPage)) rows.push(row);
  return rows;
}

const LEGACY_PLACE_COLUMNS = ["name", "address", "rating", "types", "photoName"] as const;
const legacyPlaceWhere = { OR: LEGACY_PLACE_COLUMNS.map((column) => ({ [column]: { not: null } })) };

export interface AuditReport {
  itineraries: ColumnFindings;
  deletedStops: ColumnFindings;
  deletedDays: ColumnFindings;
  candidateLogs: ColumnFindings;
  /** Place rows still holding a name, address, rating, types or photo. */
  placeLegacyColumns: number;
  /** Place rows with coordinates past 30 days or without a fetch time. */
  placeExpiredCoords: number;
  /** Rows left in CityPlaceHintsCache, NearbyPlaceCandidatesCache, NearestStationCache and DistanceCache. */
  contentCacheRows: number;
  /** Rows (or Place rows) with anything above; 0 means nothing to clean. */
  total: number;
}

export async function auditGoogleContent(prisma: PrismaClient, now = new Date()): Promise<AuditReport> {
  const cutoff = now.getTime() - COORDS_MAX_AGE_MS;
  const page = { take: PAGE_SIZE, orderBy: { id: "asc" as const } };
  const after = (afterId: string) => ({ ...page, where: { id: { gt: afterId } } });

  const itineraries = await collect((a) => prisma.itinerary.findMany({ ...after(a), select: { id: true, days: true } }));
  const deletedStops = await collect((a) => prisma.deletedStop.findMany({ ...after(a), select: { id: true, stop: true } }));
  const deletedDays = await collect((a) => prisma.deletedDay.findMany({ ...after(a), select: { id: true, day: true } }));
  const logs = [
    ...(await collect((a) => prisma.stopCandidateLog.findMany({ ...after(a), select: { id: true, candidates: true } }))),
    ...(await collect((a) => prisma.mealCandidateLog.findMany({ ...after(a), select: { id: true, candidates: true } }))),
    ...(await collect((a) => prisma.accommodationCandidateLog.findMany({ ...after(a), select: { id: true, candidates: true } }))),
  ];

  const report: Omit<AuditReport, "total"> = {
    itineraries: auditColumn(itineraries.map((r) => r.days), "days", cutoff),
    deletedStops: auditColumn(deletedStops.map((r) => r.stop), "stop", cutoff),
    deletedDays: auditColumn(deletedDays.map((r) => r.day), "day", cutoff),
    candidateLogs: auditColumn(logs.map((r) => r.candidates), "candidates", cutoff),
    placeLegacyColumns: await prisma.place.count({ where: legacyPlaceWhere }),
    placeExpiredCoords: await prisma.place.count({
      where: {
        OR: [
          { coordsFetchedAt: { lt: new Date(cutoff) } },
          { coordsFetchedAt: null, OR: [{ lat: { not: null } }, { lng: { not: null } }] },
        ],
      },
    }),
    contentCacheRows:
      (await prisma.cityPlaceHintsCache.count()) +
      (await prisma.nearbyPlaceCandidatesCache.count()) +
      (await prisma.nearestStationCache.count()) +
      (await prisma.distanceCache.count()),
  };
  const columns = [report.itineraries, report.deletedStops, report.deletedDays, report.candidateLogs];
  const total =
    columns.reduce((sum, c) => sum + c.googleFields + c.expiredCoords, 0) +
    report.placeLegacyColumns +
    report.placeExpiredCoords +
    report.contentCacheRows;
  return { ...report, total };
}

export interface CleanupResult {
  itineraries: number;
  deletedStops: number;
  deletedDays: number;
  candidateLogs: number;
  placeLegacyColumns: number;
  contentCacheRows: number;
}

/**
 * Removes everything auditGoogleContent reports. Safe to run again: a clean
 * row isn't rewritten. Expired coordinates go first, so stripping can't
 * stamp an old, untimed coordinate as new (placeStorage.ts stampCoords).
 */
export async function cleanupGoogleContent(prisma: PrismaClient, now = new Date()): Promise<CleanupResult> {
  await purgeExpiredCoords(prisma, now);
  const page = { take: PAGE_SIZE, orderBy: { id: "asc" as const } };
  const after = (afterId: string) => ({ ...page, where: { id: { gt: afterId } } });
  const result: CleanupResult = {
    itineraries: 0,
    deletedStops: 0,
    deletedDays: 0,
    candidateLogs: 0,
    placeLegacyColumns: 0,
    contentCacheRows: 0,
  };

  for await (const row of pages((a) => prisma.itinerary.findMany({ ...after(a), select: { id: true, days: true, updatedAt: true } }))) {
    const days = cleanColumn(row.days, "days");
    if (days === null) continue;
    // Skipped if the traveler saved in between (that write was stripped
    // already); not an edit, so updatedAt stays.
    const { count } = await prisma.itinerary.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { days, updatedAt: row.updatedAt },
    });
    result.itineraries += count;
  }
  for await (const row of pages((a) => prisma.deletedStop.findMany({ ...after(a), select: { id: true, stop: true } }))) {
    const stop = cleanColumn(row.stop, "stop");
    if (stop === null) continue;
    await prisma.deletedStop.update({ where: { id: row.id }, data: { stop } });
    result.deletedStops++;
  }
  for await (const row of pages((a) => prisma.deletedDay.findMany({ ...after(a), select: { id: true, day: true } }))) {
    const day = cleanColumn(row.day, "day");
    if (day === null) continue;
    await prisma.deletedDay.update({ where: { id: row.id }, data: { day } });
    result.deletedDays++;
  }
  for await (const row of pages((a) => prisma.stopCandidateLog.findMany({ ...after(a), select: { id: true, candidates: true } }))) {
    const candidates = cleanColumn(row.candidates, "candidates");
    if (candidates === null) continue;
    await prisma.stopCandidateLog.update({ where: { id: row.id }, data: { candidates } });
    result.candidateLogs++;
  }
  for await (const row of pages((a) => prisma.mealCandidateLog.findMany({ ...after(a), select: { id: true, candidates: true } }))) {
    const candidates = cleanColumn(row.candidates, "candidates");
    if (candidates === null) continue;
    await prisma.mealCandidateLog.update({ where: { id: row.id }, data: { candidates } });
    result.candidateLogs++;
  }
  for await (const row of pages((a) => prisma.accommodationCandidateLog.findMany({ ...after(a), select: { id: true, candidates: true } }))) {
    const candidates = cleanColumn(row.candidates, "candidates");
    if (candidates === null) continue;
    await prisma.accommodationCandidateLog.update({ where: { id: row.id }, data: { candidates } });
    result.candidateLogs++;
  }

  const places = await prisma.place.updateMany({
    where: legacyPlaceWhere,
    data: { name: null, address: null, rating: null, types: null, photoName: null },
  });
  result.placeLegacyColumns = places.count;

  const caches = await Promise.all([
    prisma.cityPlaceHintsCache.deleteMany(),
    prisma.nearbyPlaceCandidatesCache.deleteMany(),
    prisma.nearestStationCache.deleteMany(),
    prisma.distanceCache.deleteMany(),
  ]);
  result.contentCacheRows = caches.reduce((sum, c) => sum + c.count, 0);

  return result;
}

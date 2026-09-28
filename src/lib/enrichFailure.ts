// A stop/meal/accommodation that Text Search couldn't resolve (no result, or
// a result too far from the day's city to trust) used to leave no trace at
// all — no placeId, nothing in PlaceQuery — so every page open re-ran the
// auto-enrich effects and re-billed Google for the exact same doomed query.
// This marker records the failed attempt on the item itself (inside the
// days JSON, no schema change) so enrich routes can skip it.
//
// Keyed by the query string rather than a bare flag: renaming the item (or
// moving it to a different city/district) changes its query, which makes the
// marker stale automatically — no edit route has to remember to clear it.

export type EnrichFailureReason = "not_found" | "too_far";

export type EnrichFailure = {
  query: string;
  reason: EnrichFailureReason;
  at: string; // ISO timestamp
};

// Matches the 30-day TTL the Places caches use — long enough that repeat
// page opens stop re-billing, short enough that a place Google adds later
// eventually gets picked up.
export const ENRICH_FAILURE_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

export function isRecentEnrichFailure(
  item: { enrichFailure?: unknown } | null | undefined,
  query: string,
  now: number = Date.now(),
): boolean {
  const f = item?.enrichFailure as Partial<EnrichFailure> | undefined;
  if (!f || f.query !== query || typeof f.at !== "string") return false;
  const at = Date.parse(f.at);
  if (Number.isNaN(at)) return false;
  return now - at < ENRICH_FAILURE_RETRY_MS;
}

export function enrichFailureMarker(
  query: string,
  reason: EnrichFailureReason,
  now: number = Date.now(),
): EnrichFailure {
  return { query, reason, at: new Date(now).toISOString() };
}

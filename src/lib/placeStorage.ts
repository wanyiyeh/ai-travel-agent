/**
 * What may be stored of a place (ADR-0004): the Google Maps Platform terms
 * allow keeping a place ID, and coordinates for up to 30 days, but not a
 * place's name, address, rating, photos or other Google content. Everything
 * written into an itinerary, a candidate log or the trash goes through
 * stripGoogleFields() in src/lib/db.ts; what's shown is fetched again when
 * it's needed (PLAN-001 #201).
 *
 * Lists of what to keep, not what to drop: a field added later is left out
 * until it's added here, so new Google data can't slip into the database.
 *
 * Behind COMPLIANT_PLACE_STORAGE=1 until fetching names back is in place, so
 * the app keeps working between the PLAN-001 pull requests.
 */

type Rec = Record<string, unknown>;

// How long coordinates may be kept (Service Specific Terms 14.3, 19.3).
// Lives here, with no database import, so scripts can share it.
export const COORDS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function isCompliantPlaceStorage(): boolean {
  return process.env.COMPLIANT_PLACE_STORAGE === "1";
}

// Fields every kind of place item may keep: our own content, the place ID,
// and coordinates with when they were fetched (purged after 30 days,
// coordsPurge.ts, ADR-0006).
const COMMON_FIELDS = [
  "id",
  "placeId",
  "lat",
  "lng",
  "coordsFetchedAt",
  "description",
  "estimated_cost",
  "enrichFailure",
  "fixedEvent",
  "copyPending",
  "suspicious",
  "suspiciousReason",
] as const;

const STOP_FIELDS = new Set<string>([
  ...COMMON_FIELDS,
  "orderIndex",
  "duration_minutes",
  "time_of_day",
  "transport_from_prev",
  // The model's own neighbourhood guess, used to pin the search (itineraryGen.ts).
  "district",
]);

const MEAL_FIELDS = new Set<string>([...COMMON_FIELDS, "estimated_cost_from"]);

const ACCOMMODATION_FIELDS = new Set<string>([
  ...COMMON_FIELDS,
  "area",
  "reason",
  "estimated_cost_low",
  "estimated_cost_high",
  "noneFound",
]);

// Candidates shown in a picker and kept in a *CandidateLog.
const CANDIDATE_FIELDS = new Set<string>([
  ...STOP_FIELDS,
  ...MEAL_FIELDS,
  ...ACCOMMODATION_FIELDS,
  "isCurrent",
  "plannedElsewhere",
]);

/**
 * A place's name is Google's once it has a place ID; without one it's the
 * model's or the traveler's own words (a train ride, a stop they typed), and
 * a 固定行程 is always the traveler's own.
 */
function keepsName(item: Rec): boolean {
  return typeof item.placeId !== "string" || item.fixedEvent != null;
}

function strip(item: unknown, fields: Set<string>): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const rec = item as Rec;
  const kept: Rec = {};
  for (const [key, value] of Object.entries(rec)) {
    if (fields.has(key)) kept[key] = value;
  }
  if (keepsName(rec) && "name" in rec) kept.name = rec.name;
  stampCoords(kept);
  return kept;
}

function hasCoords(item: Rec): boolean {
  return typeof item.lat === "number" && typeof item.lng === "number";
}

/**
 * Coordinates without a fetch time were fetched in this request (a
 * generation, an enrich, a hydrated day), so they're stamped now; a stamp
 * already there is kept, so rewriting an old day doesn't make its
 * coordinates look new (ADR-0006).
 */
function stampCoords(item: Rec): void {
  if (!hasCoords(item)) delete item.coordsFetchedAt;
  else if (typeof item.coordsFetchedAt !== "string") item.coordsFetchedAt = new Date().toISOString();
}

export function stripStop(stop: unknown): unknown {
  return strip(stop, STOP_FIELDS);
}

export function stripMeal(meal: unknown): unknown {
  return strip(meal, MEAL_FIELDS);
}

export function stripAccommodation(accommodation: unknown): unknown {
  return strip(accommodation, ACCOMMODATION_FIELDS);
}

export function stripCandidates(candidates: unknown): unknown {
  return Array.isArray(candidates) ? candidates.map((c) => strip(c, CANDIDATE_FIELDS)) : candidates;
}

/** One day: its own fields are ours, its stops, meals and lodging are stripped. */
export function stripDay(day: unknown): unknown {
  if (!day || typeof day !== "object" || Array.isArray(day)) return day;
  const rec = { ...(day as Rec) };
  if (Array.isArray(rec.stops)) rec.stops = rec.stops.map(stripStop);
  if (rec.meals && typeof rec.meals === "object") {
    rec.meals = Object.fromEntries(Object.entries(rec.meals as Rec).map(([slot, meal]) => [slot, stripMeal(meal)]));
  }
  if (rec.accommodation) rec.accommodation = stripAccommodation(rec.accommodation);
  // remove-waypoint keeps the days it replaced, so they can come back.
  if (Array.isArray(rec._originalAfter)) rec._originalAfter = rec._originalAfter.map(stripDay);
  return rec;
}

export function stripDays(days: unknown): unknown {
  return Array.isArray(days) ? days.map(stripDay) : days;
}

/**
 * For a JSON column that may arrive as an object or as an already-stringified
 * value (`j()` in db.ts): strips it and hands back the same form it came in.
 */
export function stripJsonField(value: unknown, stripper: (parsed: unknown) => unknown): unknown {
  if (typeof value !== "string") return stripper(value);
  try {
    return JSON.stringify(stripper(JSON.parse(value)));
  } catch {
    return value;
  }
}

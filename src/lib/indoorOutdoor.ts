// 室內行程為主 (plan/form-preference-wiring.md 1.9): "no sun, rain-proof".
// Google has no indoor/outdoor field, so it's judged from a place's types.

export type Exposure = "indoor" | "outdoor";

const INDOOR_TYPES = new Set([
  "museum", "art_museum", "history_museum", "art_gallery", "aquarium", "planetarium", "science_museum",
  "shopping_mall", "department_store", "movie_theater", "performing_arts_theater", "concert_hall",
  "library", "bowling_alley", "video_arcade", "amusement_center", "karaoke", "spa", "public_bath",
  "tea_house", "church", "mosque", "synagogue",
  // Most are enclosed (Skytree, Tokyo Tower); Shibuya Sky's open-air roof is the exception.
  "observation_deck",
]);

const OUTDOOR_TYPES = new Set([
  "park", "garden", "botanical_garden", "national_park", "state_park", "city_park", "hiking_area", "beach",
  "zoo", "amusement_park", "water_park", "campground", "marina", "scenic_spot", "plaza", "monument",
  // A temple or shrine visit is mostly approach paths and grounds, in the sun.
  "buddhist_temple", "shinto_shrine", "hindu_temple", "castle",
]);

/**
 * Indoor or outdoor by majority of a place's types, ties going to the first
 * one that says. Not just the first: Google orders the same place's types
 * differently from one search to the next — teamLab came back as
 * [tourist_attraction, amusement_center, art_museum, ...] in one pool and
 * [tourist_attraction, amusement_park, ...] in another, which flipped it to
 * outdoor. Its types are three indoor to one outdoor either way. Undefined
 * when nothing says (a famous crossing, a city hall) — those are neither
 * preferred nor kept off midday.
 */
export function exposureOf(types: string[] | undefined): Exposure | undefined {
  let indoor = 0;
  let outdoor = 0;
  let first: Exposure | undefined;
  for (const type of types ?? []) {
    const exposure = INDOOR_TYPES.has(type) ? "indoor" : OUTDOOR_TYPES.has(type) ? "outdoor" : undefined;
    if (!exposure) continue;
    first ??= exposure;
    if (exposure === "indoor") indoor++;
    else outdoor++;
  }
  if (indoor !== outdoor) return indoor > outdoor ? "indoor" : "outdoor";
  return first;
}

// The 11:00-15:00 sun an indoor-first traveler wants to spend inside.
export const MIDDAY_SUN = { startMinute: 11 * 60, endMinute: 15 * 60 };

// Walk up to this far between stops, then take transit (500m ≈ 6-7 minutes).
export const INDOOR_FIRST_WALK_LIMIT_KM = 0.5;

/**
 * A day's stops reordered so outdoor ones fall outside MIDDAY_SUN: the first
 * outdoor stop opens the day when it starts before the midday window, the
 * rest close it, and everything else stays in the middle in route order.
 * The opening stop brings its related places (淺草寺 and its gate, both
 * outdoor) along, so they stay back to back.
 */
export function keepOutdoorOffMidday<T extends { groupId?: string }>(
  ordered: T[],
  isOutdoor: (stop: T) => boolean,
  dayStartMinute: number
): T[] {
  const outdoor = ordered.filter(isOutdoor);
  if (outdoor.length === 0) return ordered;
  const rest = ordered.filter((s) => !isOutdoor(s));
  const first = outdoor[0];
  const morning =
    dayStartMinute < MIDDAY_SUN.startMinute
      ? outdoor.filter((s) => s === first || (first.groupId !== undefined && s.groupId === first.groupId))
      : [];
  return [...morning, ...rest, ...outdoor.filter((s) => !morning.includes(s))];
}

/**
 * The candidate pool for an indoor-first trip: everything but outdoor places
 * when that still covers `needed` stops, otherwise all of it (outdoor places
 * then only fill in, kept off midday by keepOutdoorOffMidday).
 */
export function indoorFirstPool<T>(candidates: T[], needed: number, isOutdoor: (c: T) => boolean): T[] {
  const sheltered = candidates.filter((c) => !isOutdoor(c));
  return sheltered.length >= needed ? sheltered : candidates;
}

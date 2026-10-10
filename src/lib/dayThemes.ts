import type { DurationCategory } from "@/lib/scheduler/assignTimeSlots";

// One theme per sightseeing day, rotating through the traveler's interests
// (plan/form-preference-wiring.md 1.4, phase 2). Each theme brings its own
// candidate pool (one extra Nearby Search per city, cached) and most of the
// day's stops come from it; the rest stay popular sights.

export type ThemeKey = "culture" | "nature" | "shopping" | "food" | "kids";

type Theme = {
  /** Day title after the city name: 「東京 文化巡禮」. */
  label: string;
  /** Nearby Search includedTypes for the theme's own pool. */
  searchTypes: string[];
  /** A place is on theme when any of its Google types is here. */
  matchTypes: string[];
  /** Duration categories boosted on unthemed days (transit, return day). */
  boostCategories: DurationCategory[];
};

// Temples, shrines and castles aren't searched for (a shrine search returns
// dozens of tiny neighborhood shrines) but count as culture when the popular
// pool has them — in Asian cities they're most of what cultural sightseeing is.
const PLACES_OF_WORSHIP = ["buddhist_temple", "shinto_shrine", "hindu_temple", "church", "mosque", "synagogue", "place_of_worship"];

export const THEMES: Record<ThemeKey, Theme> = {
  culture: {
    label: "文化巡禮",
    searchTypes: ["museum", "art_museum", "art_gallery", "historical_place", "historical_landmark", "monument"],
    matchTypes: ["museum", "art_museum", "history_museum", "art_gallery", "historical_place", "historical_landmark", "monument", "castle", ...PLACES_OF_WORSHIP],
    boostCategories: ["museum", "temple", "landmark"],
  },
  nature: {
    label: "自然漫遊",
    searchTypes: ["park", "garden", "botanical_garden", "observation_deck"],
    matchTypes: ["park", "garden", "botanical_garden", "national_park", "state_park", "observation_deck", "scenic_spot"],
    boostCategories: ["park", "viewpoint"],
  },
  shopping: {
    label: "購物散策",
    searchTypes: ["gift_shop", "market", "supermarket", "shopping_mall", "department_store"],
    matchTypes: ["gift_shop", "market", "supermarket", "shopping_mall", "department_store"],
    boostCategories: ["shopping"],
  },
  // 親子 (plan/form-preference-wiring.md 1.5). Only types seen in real cached
  // results: one Google doesn't know fails the whole search, and
  // planetarium / wildlife_park never came up.
  kids: {
    label: "親子同樂",
    searchTypes: ["zoo", "aquarium", "amusement_park", "water_park", "playground", "indoor_playground"],
    matchTypes: ["zoo", "aquarium", "amusement_park", "water_park", "playground", "indoor_playground"],
    boostCategories: ["park"],
  },
  food: {
    label: "市場美食",
    searchTypes: ["market", "farmers_market", "food_court"],
    matchTypes: ["market", "farmers_market", "food_court"],
    boostCategories: ["shopping"],
  },
};

// interestBoost holds both the form's interests and free-text tags from
// parsePreferenceIntent, which aren't a fixed list. Tags with no theme
// (adventure, nightlife, ...) are ignored.
const TAG_TO_THEME: Record<string, ThemeKey> = {
  culture: "culture",
  history: "culture",
  architecture: "culture",
  art: "culture",
  nature: "nature",
  shopping: "shopping",
  food: "food",
  kids: "kids",
  // water / land have no city theme: they pick the suburb trip (suburbTrips.ts).
};

/** The traveler's themes in the order they were given, each once. */
export function themesOf(interestBoost: string[]): ThemeKey[] {
  const keys = interestBoost.map((tag) => TAG_TO_THEME[tag]).filter((k): k is ThemeKey => k !== undefined);
  return [...new Set(keys)];
}

/**
 * Each day's theme, rotating through `themes`. `firstIndex` continues the
 * rotation across cities, so a two-theme trip of one-day cities doesn't give
 * every city the first theme. With no themes, every day is undefined.
 */
export function dayThemeKeys(themes: ThemeKey[], dayCount: number, firstIndex = 0): (ThemeKey | undefined)[] {
  return Array.from({ length: dayCount }, (_, i) => (themes.length > 0 ? themes[(firstIndex + i) % themes.length] : undefined));
}

export function isOnTheme(types: string[] | undefined, theme: ThemeKey): boolean {
  return (types ?? []).some((t) => THEMES[theme].matchTypes.includes(t));
}

/**
 * How many of a themed day's `count` stops stay popular sights: about a
 * third (6 → 2, 3 → 1, 2 → 1). A one-stop day is all theme.
 */
export function popularSlots(count: number): number {
  return count <= 1 ? 0 : Math.max(1, Math.floor(count / 3));
}

const INTEREST_BOOST_WEIGHT = 1.5;

/**
 * Score multipliers by duration category for days without a theme of their
 * own (the transit day's arrival stops and the return day), so they still
 * lean toward the traveler's interests.
 */
export function interestWeightsOf(interestBoost: string[]): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const theme of themesOf(interestBoost)) {
    for (const category of THEMES[theme].boostCategories) weights[category] = INTEREST_BOOST_WEIGHT;
  }
  return weights;
}

import type { DurationCategory } from "@/lib/scheduler/assignTimeSlots";

// One theme per sightseeing day, rotating through the traveler's interests
// (plan/form-preference-wiring.md 1.4, phase 2). Each theme brings its own
// candidate pool (one extra Nearby Search per city, cached) and most of the
// day's stops come from it; the rest stay popular sights.

export type ThemeKey = "culture" | "nature" | "shopping" | "food" | "kids" | "old_street" | "pets";

type Theme = {
  /** Day title after the city name: 「東京 文化巡禮」. */
  label: string;
  /** Nearby Search includedTypes for the theme's own pool. */
  searchTypes: string[];
  /**
   * What Google has no type for, searched by text naming the city (「宜蘭 老街」),
   * each kept within `km` of the center — Text Search only leans towards it.
   * `domestic`: a trip in Taiwan, where a 商店街 is a 老街.
   */
  textSearches?: (city: string, domestic: boolean) => { query: string; km: number }[];
  /** A place is on theme when any of its Google types is here... */
  matchTypes: string[];
  /** ...or its name matches. */
  matchName?: RegExp;
  /**
   * What the theme is about, where narrower than matchTypes — the place a
   * themed day starts from (isCoreOfTheme). An observation deck counts on a
   * 自然漫遊 day, but 東京鐵塔 starting one made it a day of towers.
   */
  coreTypes?: string[];
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
    coreTypes: ["park", "garden", "botanical_garden", "national_park", "state_park", "scenic_spot"],
    boostCategories: ["park", "viewpoint"],
  },
  // 購物 (2026-10-11): department stores and malls by type; shopping streets,
  // select shops, shopping districts and outlets by text. Not supermarkets
  // (every day links to one near the lodging) nor markets (市場美食's).
  shopping: {
    label: "購物散策",
    searchTypes: ["shopping_mall", "department_store"],
    textSearches: (city, domestic) => [
      { query: `${city} ${domestic ? "老街" : "商店街"}`, km: 10 },
      { query: `${city} 選物店`, km: 10 },
      { query: `${city} 購物商圈`, km: 10 },
      // Most are out of town; 御殿場 is 100km from 東京.
      { query: `${city} outlet`, km: 30 },
    ],
    matchTypes: [
      "shopping_mall",
      "department_store",
      "gift_shop",
      "clothing_store",
      "book_store",
      "electronics_store",
      "home_goods_store",
      "discount_store",
      "drugstore",
    ],
    matchName: /商店街|老街|outlet|アウトレット|選物|商圈|購物|文創|藥妝/i,
    coreTypes: ["shopping_mall", "department_store"],
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
  // 寵物 (國內, plan 1.5): both types came up in cached results.
  pets: {
    label: "毛孩同樂",
    searchTypes: ["dog_park", "dog_cafe"],
    matchTypes: ["dog_park", "dog_cafe"],
    boostCategories: ["park"],
  },
  // 國內 (plan 1.10): no Google type for an old street, so a text search and the name.
  old_street: {
    label: "老街巡禮",
    searchTypes: [],
    // A bare 「老街」 near 宜蘭 came back with 深坑 and 湖口 only, neither in 宜蘭;
    // 頭城老街 is 16km from 宜蘭's centre.
    textSearches: (city) => [{ query: `${city} 老街`, km: 20 }],
    matchTypes: [],
    matchName: /老街/,
    boostCategories: ["shopping"],
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
  old_street: "old_street",
  pets: "pets",
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
 * every city the first theme. Days in `ownTitleDays` (a day trip, a seasonal
 * or film day) have a title of their own and are skipped, so they don't use
 * up a theme: 文化, 一日遊, 文化 left 自然 out. With no themes, every day is undefined.
 */
export function dayThemeKeys(
  themes: ThemeKey[],
  dayCount: number,
  firstIndex = 0,
  ownTitleDays: ReadonlySet<number> = new Set()
): (ThemeKey | undefined)[] {
  let next = firstIndex;
  return Array.from({ length: dayCount }, (_, i) =>
    themes.length > 0 && !ownTitleDays.has(i) ? themes[next++ % themes.length] : undefined
  );
}

// Types every place has, which say nothing about what it is.
const GENERIC_TYPES = new Set(["tourist_attraction", "point_of_interest", "establishment"]);

/**
 * Whether a place is what the theme is about, by its first type that says
 * anything (or its name): 東京國立博物館 is [tourist_attraction, art_museum]. A
 * culture search also returns places that merely carry a culture type —
 * 東京鐵塔 came back first, an observation deck — so isOnTheme alone can't
 * tell the theme's most popular place.
 */
export function isCoreOfTheme(types: string[] | undefined, theme: ThemeKey, name?: string): boolean {
  const { matchTypes, coreTypes, matchName } = THEMES[theme];
  const first = (types ?? []).find((t) => !GENERIC_TYPES.has(t));
  return (first !== undefined && (coreTypes ?? matchTypes).includes(first)) || Boolean(name && matchName?.test(name));
}

export function isOnTheme(types: string[] | undefined, theme: ThemeKey, name?: string): boolean {
  const { matchTypes, matchName } = THEMES[theme];
  return (types ?? []).some((t) => matchTypes.includes(t)) || Boolean(name && matchName?.test(name));
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

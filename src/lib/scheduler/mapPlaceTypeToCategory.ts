import type { DurationCategory } from "@/lib/scheduler/assignTimeSlots";

// Priority-ordered: a place's Google `types` array almost always includes
// generic noise (point_of_interest, establishment, tourist_attraction) mixed
// with a couple of specific ones — this scans for the most specific category
// first so e.g. a castle tagged ["castle","tourist_attraction","historical_place",
// "museum", ...] lands on "landmark", not the coincidentally-also-present "museum".
// Built from real `types` returned for this project's seeded itineraries (see
// plan/hybrid-rule-engine-scheduling.md section 7's type-data-gap note) —
// covers the specific types actually observed, not every possible Google type.
const CATEGORY_PRIORITY: { category: DurationCategory; googleTypes: string[] }[] = [
  { category: "museum", googleTypes: ["museum", "art_museum", "history_museum"] },
  {
    category: "temple",
    googleTypes: ["hindu_temple", "buddhist_temple", "place_of_worship", "church", "synagogue", "mosque"],
  },
  { category: "viewpoint", googleTypes: ["observation_deck", "scenic_spot"] },
  { category: "shopping", googleTypes: ["shopping_mall", "market"] },
  { category: "park", googleTypes: ["park", "garden", "zoo", "amusement_park", "hiking_area"] },
  {
    category: "landmark",
    googleTypes: [
      "castle", "historical_place", "historical_landmark", "monument", "plaza",
      "landmark", "tourist_attraction",
    ],
  },
];

/**
 * Maps a Place's raw Google `types` array to one of assignTimeSlots.ts's six
 * duration categories, or undefined when nothing recognizable is present
 * (falls back to assignTimeSlots' flat default in that case). Pure, no I/O —
 * callers fetch `types` from the Place cache themselves.
 */
export function mapPlaceTypeToCategory(types: string[]): DurationCategory | undefined {
  const typeSet = new Set(types);
  for (const { category, googleTypes } of CATEGORY_PRIORITY) {
    if (googleTypes.some((t) => typeSet.has(t))) return category;
  }
  return undefined;
}

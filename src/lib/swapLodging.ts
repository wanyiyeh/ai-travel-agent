import { fetchLodgingCandidates, type BudgetLevel, type PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { findHotSpringLodging } from "@/lib/domesticInterests";
import { findPetFriendlyLodging } from "@/lib/petFriendly";
import type { TripPreferences } from "@/lib/schemas";

// 換一間 (accommodation/regenerate): the same lodging rules as generating the
// trip (itineraryCityGen.ts fetchMealLodgingPools), so swapping a stay can't
// undo them — a trip with a dog was offered ordinary hotels.

export type SwapLodgingRules = {
  /** 寵物: only stays that take dogs. */
  pets: boolean;
  /** 親子, 長輩: no hostels. */
  noHostels: boolean;
  /** 獨旅: close to a station first. */
  solo: boolean;
  /** 溫泉: hot-spring hotels first. */
  hotSpring: boolean;
};

export function swapLodgingRulesOf(preferences: TripPreferences | undefined): SwapLodgingRules {
  const companions = preferences?.companions ?? [];
  return {
    pets: companions.includes("pets"),
    noHostels: companions.includes("kids") || companions.includes("seniors"),
    solo: companions.includes("solo"),
    hotSpring: Boolean(preferences?.interests?.includes("hot_spring")),
  };
}

// Each candidate costs a station lookup, so the list stays short.
const SWAP_LODGING_COUNT = 10;

export async function findSwapLodging(
  center: { lat: number; lng: number },
  apiKey: string,
  budget: BudgetLevel | undefined,
  rules: SwapLodgingRules
): Promise<PlaceCandidate[]> {
  const isHotSpring = (p: PlaceCandidate) => /溫泉|温泉|湯/.test(p.name);
  if (rules.pets) {
    const stays = await findPetFriendlyLodging(center, apiKey);
    const ordered = rules.hotSpring ? [...stays.filter(isHotSpring), ...stays.filter((p) => !isHotSpring(p))] : stays;
    return ordered.slice(0, SWAP_LODGING_COUNT);
  }
  const [hotels, hotSprings] = await Promise.all([
    fetchLodgingCandidates(center, apiKey, budget, 3000, SWAP_LODGING_COUNT),
    rules.hotSpring ? findHotSpringLodging(center, apiKey) : Promise.resolve([] as PlaceCandidate[]),
  ]);
  const seen = new Set<string>();
  const merged = [...hotSprings, ...hotels].filter((p) => !seen.has(p.placeId) && seen.add(p.placeId));
  const allowed = rules.noHostels ? merged.filter((p) => !p.types?.includes("hostel")) : merged;
  return allowed.slice(0, SWAP_LODGING_COUNT);
}

/** 獨旅: the closest to a station first; ones with no station found last. */
export function nearStationOrder<T extends { nearestStation?: { distanceMeters: number } | null }>(candidates: T[]): T[] {
  const distance = (c: T) => c.nearestStation?.distanceMeters ?? Infinity;
  return [...candidates].sort((a, b) => distance(a) - distance(b));
}

import { searchTextCandidates, type FieldTier, type PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { haversineKm } from "@/lib/geo";

// 寵物 (國內 only, plan/form-preference-wiring.md 1.5, phase 5c). Google's
// allowsDogs field is a pricier tier and often blank for Taiwan's hotels, so
// places come from a text search for 「寵物友善」 instead, whose results
// Google ranks by what the place and its reviews say.

// Wider than the meal and lodging searches' 3km (itineraryCityGen.ts): there
// are fewer such places, and pet-friendly 民宿 often sit outside town.
const PET_LODGING_KM = 10;
const PET_RESTAURANT_KM = 5;

const within = (center: { lat: number; lng: number }, km: number) => (p: PlaceCandidate) =>
  haversineKm(center.lat, center.lng, p.lat, p.lng) <= km;

/** Lodging that takes dogs. Only these are offered: a stay that turns the dog away ends the trip. */
export async function findPetFriendlyLodging(center: { lat: number; lng: number }, apiKey: string): Promise<PlaceCandidate[]> {
  const found = await searchTextCandidates("寵物友善住宿", center, apiKey, PET_LODGING_KM * 1000, "lodging").catch(
    () => [] as PlaceCandidate[]
  );
  return found.filter(within(center, PET_LODGING_KM));
}

/** Restaurants that take dogs, put ahead of the others for lunch and dinner. */
export async function findPetFriendlyRestaurants(
  center: { lat: number; lng: number },
  apiKey: string,
  tier: FieldTier
): Promise<PlaceCandidate[]> {
  const found = await searchTextCandidates("寵物友善餐廳", center, apiKey, PET_RESTAURANT_KM * 1000, "restaurant", { tier }).catch(
    () => [] as PlaceCandidate[]
  );
  return found.filter(within(center, PET_RESTAURANT_KM));
}

/** A city with no pet-friendly lodging: no stay suggested, and why. */
export function noPetLodging(city: string): Record<string, unknown> {
  return {
    name: "",
    area: city,
    reason: "這附近找不到寵物友善的住宿，請自行尋找可以帶狗的住宿",
    // Not a stay to look up: enrich would fill in any hotel by the area's name.
    noneFound: true,
  };
}

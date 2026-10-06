import type { BudgetLevel } from "@/lib/fetchCityRestaurants";

// Where to look for lodging and restaurants in cities whose sights are spread
// across several districts. Attractions still search around the city center
// (placesTextSearch.ts CITY_CENTER_OVERRIDES — Tokyo Station reaches both
// Shinjuku and Asakusa within 10 km), but a 3 km lodging/meal search around
// Tokyo Station lands in the Marunouchi/Nihonbashi business district, which
// few visitors stay in. Since stops are scored by distance from the lodging,
// this area also shapes the whole trip. Add a city here only when one center
// can't serve both sights and stays.

type Area = { label: string; lat: number; lng: number };

const STAY_AREAS: Record<string, Record<BudgetLevel | "default", Area>> = {
  東京: {
    budget: { label: "淺草／上野", lat: 35.714, lng: 139.787 }, // where hostels cluster
    moderate: { label: "新宿", lat: 35.6896, lng: 139.7006 }, // transit hub, most visitors stay here
    luxury: { label: "銀座／丸之內", lat: 35.676, lng: 139.766 }, // international brand hotels
    default: { label: "新宿", lat: 35.6896, lng: 139.7006 },
  },
};

/** The district to search lodging and meals in for this budget, or undefined to use the city center. */
export function stayAreaFor(cityName: string, budget: BudgetLevel | undefined): Area | undefined {
  const areas = STAY_AREAS[cityName];
  return areas ? areas[budget ?? "default"] : undefined;
}

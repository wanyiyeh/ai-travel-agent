// Shared TypeScript types for Itinerary data structures

import type { FixedEventInfo } from "@/lib/fixedEvents";
import type { EnrichFailure } from "@/lib/enrichFailure";

export type Stop = {
  id?: string;
  name: string;
  district?: string;
  description: string;
  duration_minutes: number;
  time_of_day?: "morning" | "afternoon" | "evening";
  transport_from_prev?: string;
  estimated_cost?: number;
  placeId?: string;
  lat?: number;
  lng?: number;
  address?: string;
  rating?: number | null;
  openingHours?: string | null;
  photoName?: string | null;
  suspicious?: boolean;
  suspiciousReason?: string;
  // Last failed Text Search attempt — enrich routes skip re-querying while
  // it's recent and the query is unchanged (see lib/enrichFailure.ts).
  enrichFailure?: EnrichFailure;
  /** Set on a 固定行程 (lib/fixedEvents.ts): pinned, with its booked time, and no 換一個. */
  fixedEvent?: FixedEventInfo;
};

export type Accommodation = {
  // Only set once a real candidate is picked — freshly-generated accommodation
  // only has area + reason (see AccommodationSchema in schemas.ts).
  name?: string;
  area: string;
  reason?: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  address?: string;
  rating?: number | null;
  priceLevel?: number | null;
  estimated_cost?: number;
  estimated_cost_low?: number;
  estimated_cost_high?: number;
  nearestStation?: { name: string; distanceMeters: number } | null;
  photoName?: string | null;
  // Last failed Text Search attempt — enrich routes skip re-querying while
  // it's recent and the query is unchanged (see lib/enrichFailure.ts).
  enrichFailure?: EnrichFailure;
  // No stay to suggest (no pet-friendly lodging nearby): enrich leaves it alone.
  noneFound?: true;
};

// Candidates always come from a real Google Places result, so unlike the
// freshly-generated Accommodation (area + reason only), name is guaranteed.
export type AccommodationCandidate = Omit<Accommodation, "name"> & {
  name: string;
  isCurrent?: boolean;
};

export type Meal = {
  name: string;
  description?: string;
  estimated_cost?: number;
  placeId?: string;
  lat?: number;
  lng?: number;
  address?: string;
  rating?: number | null;
  photoName?: string | null;
  // Last failed Text Search attempt — enrich routes skip re-querying while
  // it's recent and the query is unchanged (see lib/enrichFailure.ts).
  enrichFailure?: EnrichFailure;
  /** Set on a reservation (固定行程) standing in for this meal: no 換一家. */
  fixedEvent?: FixedEventInfo;
};

export type DayMeals = {
  breakfast?: Meal;
  lunch?: Meal;
  dinner?: Meal;
  snack?: Meal;
  /** 小酌 after dinner — only when the traveler picked 酒 (drinkPlaces.ts). */
  nightcap?: Meal;
};

export type MealCandidate = Meal & {
  isCurrent?: boolean;
  /** Set when this place is already planned for another meal of the trip, e.g. "第 3 天晚餐已安排". */
  plannedElsewhere?: string;
};

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "nightcap"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export function isMealType(value: string): value is MealType {
  return (MEAL_TYPES as readonly string[]).includes(value);
}

export type StopCandidate = {
  name: string;
  description: string;
  duration_minutes: number;
  placeId?: string;
  lat?: number;
  lng?: number;
  address?: string;
  rating?: number | null;
  photoName?: string | null;
  suspicious?: boolean;
  suspiciousReason?: string;
};

export type TransitRecommendation = {
  name: string;
  type: "city" | "country";
  country: string;
  iataCode?: string;
  transitTimeHours: number;
  transitMode: string;
  suggestedStayDaysMin: number;
  suggestedStayDaysMax: number;
  popularity: "high" | "medium" | "low";
  topAttractions: string[];
  lat: number;
  lng: number;
};

export type CartItem = {
  recommendation: TransitRecommendation;
  stayDays: number;
  order: number;
};

export type Day = {
  id?: string;
  day: number;
  theme?: string;
  stops: Stop[];
  accommodation?: Accommodation | null;
  meals?: DayMeals;
  isTransitDay?: boolean;
  transitTo?: string;
  waypointCity?: string;
  // A locked day's `stops` holds exactly one full-day attraction; guarded
  // against regeneration/trimming/reordering by every day-mutating route.
  isLocked?: boolean;
  // 「日落約 16:30・這個月常下雨，記得帶傘」, from last year's weather (dayConditions.ts).
  weatherNote?: string;
  // A day trip's town or a seasonal day's theme, to find tours for (tourLinks.ts).
  tourKeyword?: string;
};

export type Itinerary = {
  title: string;
  currency?: string;
  days: Day[];
};

export type StopWithId = Stop & {
  id: string;
  orderIndex: number;
};

export type DayWithId = Omit<Day, "stops"> & {
  id: string;
  stops: StopWithId[];
};

export type ItineraryWithId = Omit<Itinerary, "days"> & {
  id: string;
  days: DayWithId[];
};

export type ItineraryResponse = {
  success: boolean;
  id: string;
  data: Itinerary;
};

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}分鐘`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}小時`;
  }
  return `${hours}小時${mins}分鐘`;
}

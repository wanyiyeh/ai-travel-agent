// Shared TypeScript types for Itinerary data structures

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
  suspicious?: boolean;
  suspiciousReason?: string;
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
};

export type DayMeals = {
  breakfast?: Meal;
  lunch?: Meal;
  dinner?: Meal;
};

export type MealCandidate = Meal & {
  isCurrent?: boolean;
};

export const MEAL_TYPES = ["breakfast", "lunch", "dinner"] as const;
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

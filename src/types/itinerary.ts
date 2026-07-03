// Shared TypeScript types for Itinerary data structures

export type Stop = {
  id?: string;
  name: string;
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
  name: string;
  area: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  address?: string;
  rating?: number | null;
  priceLevel?: number | null;
  bookingUrl?: string;
};

export type Meal = {
  name: string;
  description?: string;
  estimated_cost?: number;
};

export type DayMeals = {
  breakfast?: Meal;
  lunch?: Meal;
  dinner?: Meal;
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

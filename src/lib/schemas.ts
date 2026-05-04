import { z } from "zod";

const iataCode = z
  .string()
  .regex(/^[A-Z]{3}$/, "請輸入 3 碼 IATA 機場代號（大寫英文字母，例：TPE）");

export const FlightInfoSchema = z.object({
  departureCity: iataCode,      // 去程出發機場 IATA 代號，例：TPE
  arrivalCity: iataCode,        // 去程抵達機場 IATA 代號，例：SYD
  returnDepartureCity: iataCode, // 回程出發機場 IATA 代號，例：MEL
  departureDate: z.string().min(1),      // YYYY-MM-DD
  returnDate: z.string().min(1),         // YYYY-MM-DD
  arrivalTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),         // 去程航班抵達時間 HH:MM
  returnDepartureTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), // 回程航班出發時間 HH:MM
});

export type FlightInfo = z.infer<typeof FlightInfoSchema>;

export const TripPreferencesSchema = z.object({
  pace: z.enum(["relaxed", "moderate", "intensive"]).optional(),
  budget: z.enum(["budget", "moderate", "luxury"]).optional(),
  interests: z
    .array(z.enum(["food", "culture", "nature", "shopping", "adventure"]))
    .optional(),
});

export type TripPreferences = z.infer<typeof TripPreferencesSchema>;

export const AccommodationSchema = z.object({
  name: z.string(),
  area: z.string(),
});

export const StopSchema = z.object({
  name: z.string(),
  description: z.string(),
  duration_minutes: z.number(),
  time_of_day: z.enum(["morning", "afternoon", "evening"]).optional(),
  transport_from_prev: z.string().optional(),
  estimated_cost: z.number().optional(),
});

const MealSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  estimated_cost: z.number().optional(),
});

const DayMealsSchema = z.object({
  breakfast: MealSchema.optional(),
  lunch: MealSchema.optional(),
  dinner: MealSchema.optional(),
});

export const DaySchema = z.object({
  day: z.number(),
  theme: z.string().optional(),
  stops: z.array(StopSchema),
  accommodation: AccommodationSchema.optional(),
  meals: DayMealsSchema.optional(),
});

export const ItinerarySchema = z.object({
  title: z.string(),
  currency: z.string().optional(),
  days: z.array(DaySchema),
});

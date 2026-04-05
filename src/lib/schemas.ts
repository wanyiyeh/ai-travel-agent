import { z } from "zod";

export const TripPreferencesSchema = z.object({
  origin: z.string().optional(),
  pace: z.enum(["relaxed", "moderate", "intensive"]).optional(),
  budget: z.enum(["budget", "moderate", "luxury"]).optional(),
  interests: z
    .array(z.enum(["food", "culture", "nature", "shopping", "adventure"]))
    .optional(),
});

export type TripPreferences = z.infer<typeof TripPreferencesSchema>;

export const StopSchema = z.object({
  name: z.string(),
  description: z.string(),
  duration_minutes: z.number(),
});

export const DaySchema = z.object({
  day: z.number(),
  theme: z.string().optional(),
  stops: z.array(StopSchema),
});

export const ItinerarySchema = z.object({
  title: z.string(),
  days: z.array(DaySchema),
});

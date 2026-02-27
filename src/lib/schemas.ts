import { z } from "zod";

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

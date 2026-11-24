import { z } from "zod";
import { MEAL_TYPES } from "@/types/itinerary";

// The chat assistant's reply shapes (PLAN-004, ADR-0013). The server first
// classifies a message, then asks for the reply with the one schema that
// class is allowed: a question can't come back with an edit, and nothing the
// model writes is applied before the owner confirms it.

export const CHAT_CATEGORIES = [
  "itinerary_question",
  "edit",
  "restructure",
  "place_fact",
  "travel_knowledge",
  "off_topic",
] as const;
export type ChatCategory = (typeof CHAT_CATEGORIES)[number];

export const ChatClassificationSchema = z.object({
  category: z.enum(CHAT_CATEGORIES),
  // An unsure call is treated as itinerary_question, the class that can't
  // change anything (ADR-0013).
  confident: z.boolean(),
});

// The model points at places by position, the way it sees them in the trip
// summary: day N, stop K (1-based). The server turns these into IDs.
const DayNumber = z.number().int().min(1);
const StopNumber = z.number().int().min(1);

export const ItineraryQuestionReplySchema = z.object({
  reply: z.string(),
  // "How long from stop 1 to stop 2": the screen shows the stored transport
  // line for that stop; the model never sees it (ADR-0013).
  transportCards: z.array(z.object({ dayNumber: DayNumber, stopNumber: StopNumber })),
});

const MealType = z.enum(MEAL_TYPES);

export const EditActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("remove_stop"), dayNumber: DayNumber, stopNumber: StopNumber }),
  z.object({ action: z.literal("move_stop"), dayNumber: DayNumber, stopNumber: StopNumber, toPosition: StopNumber }),
  z.object({ action: z.literal("replace_stop"), dayNumber: DayNumber, stopNumber: StopNumber }),
  // The owner's own words for what to add ("室內的"), or null.
  z.object({ action: z.literal("suggest_stops"), dayNumber: DayNumber, request: z.string().nullable() }),
  // The owner's own words for what to eat ("拉麵"), or null for any other.
  z.object({ action: z.literal("replace_meal"), dayNumber: DayNumber, mealType: MealType, request: z.string().nullable() }),
  z.object({ action: z.literal("remove_meal"), dayNumber: DayNumber, mealType: MealType }),
  z.object({ action: z.literal("restore_meal"), dayNumber: DayNumber, mealType: MealType }),
  z.object({ action: z.literal("replace_accommodation"), dayNumber: DayNumber }),
]);
export type EditAction = z.infer<typeof EditActionSchema>;
export type EditActionName = EditAction["action"];

export const EditReplySchema = z.object({
  reply: z.string(),
  // Empty when the model has to ask which place was meant.
  actions: z.array(EditActionSchema),
});

export const RestructureReplySchema = z.object({
  reply: z.string(),
  // The whole route after the change, in order; null when the model has to
  // ask. Which days to keep and what to regenerate is the server's (#372).
  cities: z
    .array(z.object({ name: z.string(), days: z.number().int().min(1), isNew: z.boolean() }))
    .nullable(),
});

export const PlaceFactReplySchema = z.object({
  reply: z.string(),
  // Places whose 「照片與詳情」 to offer; the facts themselves come from
  // Google on screen, not from the model (v1.5 is #363).
  places: z.array(z.object({ dayNumber: DayNumber, stopNumber: StopNumber })),
});

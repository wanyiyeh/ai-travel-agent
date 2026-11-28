import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

vi.mock("@/lib/db", () => ({ prisma: {}, j: (v: unknown) => v }));

const { outputFormat } = await import("@/lib/llm");
const { PreferenceIntentReplySchema } = await import("@/lib/preferenceIntent");
const { HighlightListSchema } = await import("@/lib/seasonalHighlights");
const { TripListSchema } = await import("@/lib/classicDayTrips");
const { WorksSchema } = await import("@/lib/filmLocations");
const { RawTripPlanSchema } = await import("@/lib/tripPlan");
const { ItinerarySchema, StopDescriptionFillSchema, TransitRecommendationReplySchema } = await import("@/lib/schemas");
const { LegacyItineraryReplySchema } = await import("@/lib/itineraryGen");
const { DayStopsReplySchema, MealsAndLodgingReplySchema, TransitDayStopsReplySchema, TransitPlanReplySchema } = await import(
  "@/lib/itineraryCityGen"
);
const { ChatClassificationSchema, ItineraryQuestionReplySchema, EditReplySchema, RestructureReplySchema, PlaceFactReplySchema } =
  await import("@/lib/chat/schemas");

// Every schema handed to generateObject must become a JSON schema the API
// accepts: a transform, a recursive type or an open object would fail every
// real request, while unit tests (which mock generateObject) pass.
const REPLY_SCHEMAS: Record<string, z.ZodType> = {
  PreferenceIntentReplySchema,
  HighlightListSchema,
  TripListSchema,
  WorksSchema,
  RawTripPlanSchema,
  StopDescriptionFillSchema,
  TransitRecommendationReplySchema,
  TransitDayStopsReplySchema,
  TransitPlanReplySchema,
  DayStopsReplySchema,
  MealsAndLodgingReplySchema,
  LegacyItineraryReplySchema,
  ChatClassificationSchema,
  ItineraryQuestionReplySchema,
  EditReplySchema,
  RestructureReplySchema,
  PlaceFactReplySchema,
};

type JsonSchema = { type?: string; properties?: Record<string, JsonSchema>; additionalProperties?: unknown; items?: JsonSchema; anyOf?: JsonSchema[]; $defs?: Record<string, JsonSchema> };

function objectsIn(schema: JsonSchema): JsonSchema[] {
  const children = [
    ...Object.values(schema.properties ?? {}),
    ...(schema.items ? [schema.items] : []),
    ...(schema.anyOf ?? []),
    ...Object.values(schema.$defs ?? {}),
  ];
  return [...(schema.type === "object" ? [schema] : []), ...children.flatMap(objectsIn)];
}

describe("LLM reply schemas", () => {
  it.each(Object.entries(REPLY_SCHEMAS))("%s converts to a structured output format", (_name, schema) => {
    const format = outputFormat(schema);
    expect(format.type).toBe("json_schema");
    const objects = objectsIn(format.schema as JsonSchema);
    expect(objects.length).toBeGreaterThan(0);
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
    }
  });
});

describe("LegacyItineraryReplySchema", () => {
  it("gives what generate-stream's ItinerarySchema check expects", () => {
    const meal = { name: "店", description: "d", estimated_cost: 1000 };
    const stop = { name: "淺草寺", district: "淺草", description: "d", duration_minutes: 60, time_of_day: "morning", transport_from_prev: "步行約 10 分鐘", estimated_cost: 0 };
    const reply = LegacyItineraryReplySchema.parse({
      title: "東京",
      currency: "JPY",
      days: [
        { day: 1, waypointCity: "東京", stops: [stop], accommodation: { area: "淺草", reason: "r" }, meals: { breakfast: meal, lunch: meal, dinner: meal, snack: meal } },
        { day: 2, waypointCity: "東京", stops: [stop], accommodation: null, meals: { breakfast: meal, lunch: meal, dinner: meal, snack: meal } },
      ],
    });
    expect(ItinerarySchema.safeParse(reply).success).toBe(true);
  });
});

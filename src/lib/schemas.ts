import { z } from "zod";
import { MAX_PROMPT_LENGTH, MAX_TRIP_DAYS } from "@/lib/inputLimits";

const iataCode = z
  .string()
  .regex(/^[A-Z]{3}$/, "請輸入 3 碼 IATA 機場代號（大寫英文字母，例：TPE）");

const DAY_MS = 24 * 60 * 60 * 1000;

// A real calendar date: `2026-02-31` matches the shape but Date rolls it
// over to March, so round-trip it back to the same string.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式須為 YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "不是有效的日期");

export const FlightInfoSchema = z
  .object({
    departureCity: iataCode,      // 去程出發機場 IATA 代號，例：TPE
    arrivalCity: iataCode,        // 去程抵達機場 IATA 代號，例：SYD
    returnDepartureCity: iataCode, // 回程出發機場 IATA 代號，例：MEL
    returnArrivalCity: iataCode.optional(), // 回程抵達機場 IATA 代號，例：TPE（預設同去程出發地）
    departureDate: isoDate,       // YYYY-MM-DD
    returnDate: isoDate,          // YYYY-MM-DD
    arrivalTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),         // 去程航班抵達時間 HH:MM
    returnDepartureTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), // 回程航班出發時間 HH:MM
  })
  .superRefine(({ departureDate, returnDate }, ctx) => {
    const days = (Date.parse(returnDate) - Date.parse(departureDate)) / DAY_MS;
    if (!(days > 0)) {
      ctx.addIssue({ code: "custom", path: ["returnDate"], message: "回程日期必須晚於出發日期" });
    } else if (days > MAX_TRIP_DAYS) {
      ctx.addIssue({ code: "custom", path: ["returnDate"], message: `行程最多 ${MAX_TRIP_DAYS} 天` });
    }
  });

export type FlightInfo = z.infer<typeof FlightInfoSchema>;

// 固定行程 (plan/form-preference-wiring.md 1.11): already-booked things the
// day is planned around.
export const FIXED_EVENT_TYPE_VALUES = ["concert", "sports", "show", "reservation", "work", "other"] as const;
export type FixedEventType = (typeof FIXED_EVENT_TYPE_VALUES)[number];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const FixedEventSchema = z
  .object({
    type: z.enum(FIXED_EVENT_TYPE_VALUES),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(HHMM),
    endTime: z.string().regex(HHMM).optional(),
    // Optional only for work: no place means working from the lodging.
    venueName: z.string().max(200).optional(),
    // Concerts, games, shows: how long before the start to be there (queue,
    // merch, dinner nearby). Defaults by type (fixedEvents.ts).
    arriveEarlyMinutes: z.number().int().min(0).max(240).optional(),
    // The city the event is in, for a multi-city trip: the route must be
    // there that day (tripPlan.ts). Optional — a one-city trip needs none.
    city: z.string().max(100).optional(),
  })
  .refine((e) => e.type !== "work" || e.endTime, { message: "工作需要結束時間", path: ["endTime"] })
  .refine((e) => e.type === "work" || (e.venueName ?? "").trim().length > 0, { message: "請填地點", path: ["venueName"] })
  .refine((e) => !e.endTime || e.endTime > e.startTime, { message: "結束時間要晚於開始時間", path: ["endTime"] });

export type FixedEvent = z.infer<typeof FixedEventSchema>;

export const TripPreferencesSchema = z.object({
  pace: z.enum(["relaxed", "moderate", "intensive"]).optional(),
  budget: z.enum(["budget", "moderate", "luxury"]).optional(),
  // 水上活動 (water) and 陸上活動 (land) replaced 冒險戶外 (adventure) on the
  // form; "adventure" stays valid for older itineraries' stored config and
  // counts as land (suburbTrips.ts).
  interests: z
    .array(z.enum(["food", "culture", "nature", "shopping", "water", "land", "adventure"]))
    .max(7)
    .optional(),
  // No longer on the form (plan/form-preference-wiring.md 1.1) — kept so
  // older itineraries' stored config still parses.
  travelers: z.number().int().min(1).max(20).optional(),
  startTime: z.enum(["early", "normal", "late"]).optional(),
  // Same tags parsePreferenceIntent() emits, so the two sources merge cleanly.
  dietaryRestrictions: z
    .array(z.enum(["vegetarian", "vegan", "no_seafood", "no_beef", "halal", "no_spicy"]))
    .max(6)
    .optional(),
  // 飲品 (plan/form-preference-wiring.md 1.8): coffee or tea places for the
  // snack; alcohol adds a 小酌 after dinner.
  drinks: z.array(z.enum(["coffee", "tea", "alcohol"])).max(3).optional(),
  // 室內行程為主 (plan/form-preference-wiring.md 1.9): indoor places first,
  // outdoor ones kept off 11:00-15:00, transit beyond a short walk.
  indoorFirst: z.boolean().optional(),
  fixedEvents: z.array(FixedEventSchema).max(10).optional(),
  // 交通方式 (plan/form-preference-wiring.md 1.7): self-drive means renting a
  // car on arrival for the whole trip. Unset is public transport.
  transport: z.enum(["transit", "drive"]).optional(),
  // 季節限定景點 (plan/form-preference-wiring.md 1.12): on unless the
  // traveler unticks it, so only `false` turns it off.
  seasonalHighlights: z.boolean().optional(),
  // 同行者 (plan/form-preference-wiring.md 1.5): 獨旅 can't go with 親子 or 長輩.
  companions: z
    .array(z.enum(["solo", "kids", "seniors"]))
    .max(3)
    .refine((c) => !(c.includes("solo") && (c.includes("kids") || c.includes("seniors"))), {
      message: "獨旅不能跟親子、長輩一起選",
    })
    .optional(),
});

export type TripPreferences = z.infer<typeof TripPreferencesSchema>;

export const GenerateRequestSchema = z.object({
  prompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
  flightInfo: FlightInfoSchema,
  preferences: TripPreferencesSchema.optional(),
  // Cloudflare Turnstile token from the form's widget (verified server-side
  // in generate-stream; plan/access-control.md §3).
  turnstileToken: z.string().max(4096).optional(),
});

// Structured intent parsed from the user's free-text preference blurb by
// parsePreferenceIntent() — see plan/hybrid-rule-engine-scheduling.md Phase 1.
export const PreferenceIntentSchema = z.object({
  pace: z.enum(["relaxed", "moderate", "intensive"]).nullable(),
  startTimePreference: z.enum(["early", "normal", "late"]).nullable(),
  interestBoost: z.array(z.string()),
  dietaryRestrictions: z.array(z.string()),
  avoid: z.array(z.string()),
  // From the form only (mergePreferenceIntent); the free-text parse never sets it.
  indoorFirst: z.boolean().optional(),
  // Form only, like indoorFirst: renting a car (transport "drive").
  selfDrive: z.boolean().optional(),
  // Form only: traveling with children (同行者 親子).
  kids: z.boolean().optional(),
  // Form only: traveling with older relatives (同行者 長輩).
  seniors: z.boolean().optional(),
  // Form only: traveling alone (同行者 獨旅).
  solo: z.boolean().optional(),
});

export type PreferenceIntent = z.infer<typeof PreferenceIntentSchema>;

// Returned whenever parsing fails or there's no free text to parse, so a
// parsing failure degrades to "no extra preference signal" rather than
// blocking itinerary generation.
export const NEUTRAL_PREFERENCE_INTENT: PreferenceIntent = {
  pace: null,
  startTimePreference: null,
  interestBoost: [],
  dietaryRestrictions: [],
  avoid: [],
};

// LLM copy-fill response for a rule-engine skeleton — see generateSkeletonCopy()
// and plan/hybrid-rule-engine-scheduling.md section 4b. Deliberately keyed by
// the skeleton's own stop ids (not name-matched, not an array the model could
// reorder/drop from) and carries no time/order/location fields at all, so
// there is no field here the model could use to override the skeleton even by
// accident — only text.
export const SkeletonCopySchema = z.object({
  dayTheme: z.string().optional(),
  stops: z.record(
    z.string(),
    z.object({
      description: z.string(),
      highlight: z.string().optional(),
    })
  ),
});

export type SkeletonCopy = z.infer<typeof SkeletonCopySchema>;

export const AccommodationSchema = z.object({
  // Generation prompt (itineraryGen.ts rule 7) deliberately only asks the AI
  // for an area + reason, not a specific hotel name (to avoid hallucinated
  // hotel names) — name only shows up once the user picks a real candidate.
  name: z.string().optional(),
  area: z.string(),
  reason: z.string().optional(),
  placeId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  address: z.string().optional(),
  rating: z.number().nullable().optional(),
  priceLevel: z.number().nullable().optional(),
  estimated_cost: z.number().optional(),
  estimated_cost_low: z.number().optional(),
  estimated_cost_high: z.number().optional(),
  nearestStation: z
    .object({ name: z.string(), distanceMeters: z.number() })
    .nullable()
    .optional(),
  photoName: z.string().nullable().optional(),
});

export const StopSchema = z.object({
  name: z.string(),
  district: z.string().optional(),
  description: z.string(),
  duration_minutes: z.number(),
  time_of_day: z.enum(["morning", "afternoon", "evening"]).optional(),
  transport_from_prev: z.string().optional(),
  estimated_cost: z.number().optional(),
});

export const StopCandidateSchema = z.object({
  name: z.string(),
  description: z.string(),
  duration_minutes: z.number(),
  placeId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  address: z.string().optional(),
  rating: z.number().nullable().optional(),
  photoName: z.string().nullable().optional(),
  suspicious: z.boolean().optional(),
  suspiciousReason: z.string().optional(),
});

// Internal schema for parsing the LLM's description-fill response — matched
// 1:1 by index against real Places candidate names, never used to invent places.
export const StopDescriptionFillSchema = z.object({
  candidates: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      duration_minutes: z.number(),
    })
  ),
});

export const MealSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  estimated_cost: z.number().optional(),
  placeId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  address: z.string().optional(),
  rating: z.number().nullable().optional(),
  photoName: z.string().nullable().optional(),
});

const nullableMeal = MealSchema.nullish().transform((v) => v ?? undefined);

const DayMealsSchema = z.object({
  breakfast: nullableMeal,
  lunch: nullableMeal,
  dinner: nullableMeal,
  snack: nullableMeal,
  nightcap: nullableMeal,
});

export const TransitRecommendationSchema = z.object({
  name: z.string(),
  type: z.enum(["city", "country"]),
  country: z.string(),
  iataCode: z.string().optional(),
  transitTimeHours: z.number(),
  transitMode: z.string(),
  suggestedStayDaysMin: z.number().int().min(1),
  suggestedStayDaysMax: z.number().int().min(1),
  popularity: z.enum(["high", "medium", "low"]),
  topAttractions: z.array(z.string()).length(3),
  lat: z.number(),
  lng: z.number(),
});

export type TransitRecommendation = z.infer<typeof TransitRecommendationSchema>;

export const DaySchema = z.object({
  day: z.number(),
  theme: z.string().optional(),
  stops: z.array(StopSchema),
  accommodation: AccommodationSchema.nullable().optional(),
  meals: DayMealsSchema.optional(),
  isTransitDay: z.boolean().optional(),
  transitTo: z.string().nullish().transform(v => v ?? undefined),
  waypointCity: z.string().optional(),
  isLocked: z.boolean().optional(),
  // 「日落約 16:30・這個月常下雨，記得帶傘」 (dayConditions.ts).
  weatherNote: z.string().optional(),
});

export const ItinerarySchema = z.object({
  title: z.string(),
  currency: z.string().optional(),
  days: z.array(DaySchema),
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_LIST_LENGTH, MAX_NAME_LENGTH } from "@/lib/inputLimits";
import { prisma, j } from "@/lib/db";
import { StopCandidateSchema, StopDescriptionFillSchema } from "@/lib/schemas";
import { lookupByQuery, upsertPlace } from "@/lib/placeCache";
import { resolvePlace, getCityCenter } from "@/lib/placesTextSearch";
import { estimateAttractionCost } from "@/lib/priceLevelCost";
import { openai } from "@/lib/openai";
import { findDayIndex, getCityHintForDay } from "@/lib/itineraryDays";
import { internalErrorResponse } from "@/lib/apiError";
import { UNTRUSTED_INPUT_RULE, wrapUntrusted } from "@/lib/untrustedInput";
import { authorizeItinerary } from "@/lib/auth/ownership";
import { chargePaidEdit } from "@/lib/quota";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
  stopName: z.string().min(1).max(MAX_NAME_LENGTH),
});

const BatchRequestSchema = z.object({
  itineraryId: z.string().min(1),
  stops: z.array(StopCandidateSchema).min(1).max(MAX_LIST_LENGTH),
});

// Default stay length for a manually-added stop — same fallback used by
// stop-suggestions/route.ts for candidates without an AI-estimated duration;
// user can adjust it after adding.
const DEFAULT_DURATION_MINUTES = 60;

// Manually-added stops get the same kind of descriptive sentence AI-generated
// stops have — ask the model for one. Best-effort: on failure the description
// stays empty, since the stored text may not carry Google's rating or address
// (ADR-0004).
async function describeStopWithAI(
  name: string,
  tripContext: string,
  cityHint: string,
): Promise<string | null> {
  try {
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `你是專業的旅遊規劃專家。Always respond in Traditional Chinese (繁體中文).
Output strictly valid JSON matching this schema:
{ "candidates": [{ "name": string, "description": string, "duration_minutes": number }] }
The array MUST have exactly 1 item, with the EXACT SAME "name" value as the place name given in the user message. Do not rename it — only fill in "description" and "duration_minutes".${UNTRUSTED_INPUT_RULE}`,
        },
        {
          // `name` is whatever the traveler typed, so it goes here as tagged
          // data rather than into the system prompt above.
          role: "user",
          content: `Trip: ${tripContext}${cityHint ? `. City: ${cityHint}` : ""}. Write a short (one sentence) Traditional Chinese description and a suggested visit duration (minutes) for this place:\n${wrapUntrusted(name)}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const aiContent = completion.choices[0].message.content;
    if (!aiContent) return null;

    const parsedAI = StopDescriptionFillSchema.safeParse(JSON.parse(aiContent));
    if (!parsedAI.success) return null;

    return parsedAI.data.candidates[0]?.description ?? null;
  } catch {
    return null;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dayId: string }> }
) {
  try {
    const { dayId } = await params;
    const body = await request.json();

    // Batch path: pre-resolved candidates (from stop-suggestions or another
    // day's already-enriched stops) — no LLM call, write geo fields as-is.
    if (Array.isArray((body as Record<string, unknown>)?.stops)) {
      const parsedBatch = BatchRequestSchema.safeParse(body);
      if (!parsedBatch.success) {
        return NextResponse.json(
          { error: "Invalid request", details: parsedBatch.error.flatten() },
          { status: 400 }
        );
      }

      const { itineraryId, stops: candidates } = parsedBatch.data;

      const access = await authorizeItinerary(itineraryId);
      if (!access.ok) return access.response;
      const { itinerary } = access;

      const days = itinerary.days as Record<string, unknown>[];
      const dayIndex = findDayIndex(days, dayId);
      if (dayIndex === -1) {
        return NextResponse.json({ error: "Day not found" }, { status: 404 });
      }

      const stops = (days[dayIndex].stops as Record<string, unknown>[]) ?? [];
      const newStops = candidates.map((c, i) => ({
        id: crypto.randomUUID(),
        name: c.name,
        description: c.description,
        duration_minutes: c.duration_minutes,
        orderIndex: stops.length + i,
        ...(c.placeId
          ? { placeId: c.placeId, lat: c.lat, lng: c.lng, address: c.address, rating: c.rating ?? null }
          : {}),
      }));

      (days[dayIndex].stops as Record<string, unknown>[]).push(...newStops);

      await prisma.itinerary.update({
        where: { id: itineraryId },
        data: { days: j(days) },
      });

      return NextResponse.json({ stops: newStops });
    }

    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { itineraryId, stopName } = parsed.data;

    const access = await authorizeItinerary(itineraryId);
    if (!access.ok) return access.response;
    const { itinerary } = access;
    // Adding a stop by name calls Google + OpenAI (the batch path above
    // doesn't), so only this path counts as a paid edit.
    const charged = await chargePaidEdit(request, access.actor, itineraryId);
    if (charged) return charged;

    const days = itinerary.days as Record<string, unknown>[];
    const dayIndex = findDayIndex(days, dayId);

    if (dayIndex === -1) {
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }

    const day = days[dayIndex];
    const stops = (day.stops as Record<string, unknown>[]) ?? [];

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 503 });
    }

    // Same city-hint fallback chain as stops/[stopId]/enrich — biases the
    // text search toward the day's actual city so a generic name doesn't
    // resolve to a same-named place elsewhere.
    const cityHint = getCityHintForDay(day);
    const query = cityHint ? `${stopName} ${cityHint}` : stopName;

    // The name is what the traveler typed: ours to keep. Google's own name
    // for the place is fetched when it's shown (ADR-0004).
    let resolved: { placeId: string; lat: number; lng: number; address: string | null };

    const cached = await lookupByQuery(query);
    if (cached && cached.lat != null && cached.lng != null) {
      resolved = { placeId: cached.placeId, lat: cached.lat, lng: cached.lng, address: null };
    } else {
      const cityBias = await getCityCenter(cityHint, apiKey);
      const place = await resolvePlace(query, apiKey, cityBias);
      if (!place) {
        return NextResponse.json(
          { error: "在 Google 地圖上找不到這個地點，請確認名稱是否正確" },
          { status: 404 }
        );
      }
      resolved = place;
      await upsertPlace(query, { placeId: place.placeId, lat: place.lat, lng: place.lng });
    }

    const fallbackDescription = "";
    const aiDescription = await describeStopWithAI(stopName, itinerary.title, cityHint);
    const currency = ((itinerary.config as Record<string, unknown> | null)?.currency as string) ?? "EUR";

    const newStop = {
      id: crypto.randomUUID(),
      name: stopName,
      description: aiDescription ?? fallbackDescription,
      duration_minutes: DEFAULT_DURATION_MINUTES,
      placeId: resolved.placeId,
      lat: resolved.lat,
      lng: resolved.lng,
      ...(resolved.address ? { address: resolved.address } : {}),
      // Price level is an Enterprise field and isn't fetched: the default estimate.
      estimated_cost: estimateAttractionCost(currency, null),
      orderIndex: stops.length,
    };

    (days[dayIndex].stops as Record<string, unknown>[]).push(newStop);

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ stop: newStop });
  } catch (error) {
    return internalErrorResponse("Add Stop Error", error, "Failed to add stop");
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { openai } from "@/lib/openai";
import { StopDescriptionFillSchema } from "@/lib/schemas";
import type { StopCandidate } from "@/types/itinerary";
import { getMockMode, mockDelay, MOCK_FIXTURES } from "@/lib/mockAi";
import { fetchNearbyPlaceCandidates, type PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { upsertPlace } from "@/lib/placeCache";
import { haversineKm, centroid, SUSPICIOUS_DISTANCE_KM as SUSPICIOUS_KM } from "@/lib/distanceMatrix";
import { findDayIndex, getCityHintForDay } from "@/lib/itineraryDays";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
  context: z.string().optional(),
  excludeNames: z.array(z.string()).optional(),
  // Only set when called from the single-stop "換一個" picker — a specific
  // stop being replaced, as opposed to the day-level bulk-add flow, which
  // has no single stop to scope a candidate history log to.
  stopId: z.string().min(1).optional(),
});

async function suggestFallbackText(
  model: string,
  tripContext: string,
  dayTheme: string,
  excludeNames: string[],
): Promise<StopCandidate[]> {
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `你是專業的旅遊規劃專家。Always respond in Traditional Chinese (繁體中文).
Output strictly valid JSON matching this schema:
{ "candidates": [{ "name": string, "description": string, "duration_minutes": number }] }
Suggest 8 different attractions suitable for this day of the trip.
IMPORTANT: Do NOT suggest any of the following places already used today: ${excludeNames.map((n) => `"${n}"`).join(", ")}`,
      },
      {
        role: "user",
        content: `Trip: ${tripContext}. Day theme: ${dayTheme}. Suggest 8 new stops for this day that are not already listed.`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const aiContent = completion.choices[0].message.content;
  if (!aiContent) throw new Error("AI returned empty response");

  const parsedAI = StopDescriptionFillSchema.safeParse(JSON.parse(aiContent));
  if (!parsedAI.success) {
    throw new Error(`AI response validation failed: ${parsedAI.error.message}`);
  }

  return parsedAI.data.candidates;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dayId: string }> }
) {
  try {
    const { dayId } = await params;
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { itineraryId, context, excludeNames, stopId } = parsed.data;

    // Keep a full history of every candidate batch shown for this stop, even
    // after the user picks a different one, so it can be reviewed later —
    // only meaningful when a specific stop is being replaced (not the
    // day-level bulk-add flow, which has no stopId to scope it to).
    const logCandidates = (candidates: StopCandidate[]) =>
      stopId
        ? prisma.stopCandidateLog.create({
            data: { itineraryId, dayId, stopId, candidates: j(candidates) },
          })
        : Promise.resolve();

    const mockMode = getMockMode();
    if (mockMode === "error") {
      return NextResponse.json({ error: "Mock AI error (MOCK_AI=error)" }, { status: 500 });
    }
    if (mockMode === "slow" || mockMode === "fixture") {
      await mockDelay(mockMode === "slow" ? 3500 : 0);
      return NextResponse.json({ candidates: MOCK_FIXTURES.stopCandidates, isFallback: false });
    }

    const itinerary = await prisma.itinerary.findUnique({ where: { id: itineraryId } });
    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const dayIndex = findDayIndex(days, dayId);
    if (dayIndex === -1) {
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }

    const day = days[dayIndex];
    const stops = (day.stops as Record<string, unknown>[]) ?? [];
    const currentNames = [
      ...stops.map((s) => String(s.name).toLowerCase().trim()),
      ...(excludeNames ?? []).map((n) => n.toLowerCase().trim()),
    ];
    const currentPlaceIds = new Set(stops.map((s) => s.placeId).filter(Boolean));
    const currentCoords = stops
      .filter((s): s is Record<string, unknown> & { lat: number; lng: number } =>
        typeof s.lat === "number" && typeof s.lng === "number"
      )
      .map((s) => ({ lat: s.lat, lng: s.lng }));

    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const tripContext = context ?? itinerary.title;
    const dayTheme = typeof day.theme === "string" ? day.theme : "";

    // Anchor on the stop actually being replaced when we have one (the
    // single-stop "換一個" picker) so nearby search centers on, e.g., Raszyn
    // rather than wherever the day's first geocoded stop happens to be
    // (which could be a different city entirely on a multi-city day).
    const stopIndex = stopId ? stops.findIndex((s) => s.id === stopId) : -1;
    let anchor =
      (stopIndex >= 0 && typeof stops[stopIndex].lat === "number" && typeof stops[stopIndex].lng === "number"
        ? stops[stopIndex]
        : undefined) || stops.find((s) => typeof s.lat === "number" && typeof s.lng === "number");

    const cityHint = getCityHintForDay(day, stopIndex >= 0 ? stopIndex : undefined);

    // A transit day's later stops (per getCityHintForDay above) are required to
    // sit in transitTo, a distinct town from the day's own waypointCity/hub —
    // e.g. a small satellite like Raszyn on a Warsaw->Kraków transit day. A wide
    // radius there lets a much larger, attraction-dense neighboring city (the
    // hub) dominate the popularity-ranked results instead of the satellite's own
    // (few) nearby places. Only the hub-city case wants the wide net (see below).
    const isSatelliteStop =
      Boolean(day.isTransitDay) && stopIndex > 0 && typeof day.transitTo === "string" && day.transitTo.trim().length > 0;

    // This day has no geocoded stops of its own (e.g. a freshly-added empty day)
    // — borrow a coordinate from a sibling day tagged with the same waypointCity
    // so we can still search Google Places instead of falling straight to blind
    // AI text generation.
    if (!anchor && typeof day.waypointCity === "string" && day.waypointCity) {
      for (const sibling of days) {
        if (sibling.id === dayId || sibling.waypointCity !== day.waypointCity) continue;
        const siblingStops = (sibling.stops as Record<string, unknown>[]) ?? [];
        const found = siblingStops.find(
          (s) => typeof s.lat === "number" && typeof s.lng === "number"
        );
        if (found) {
          anchor = found;
          break;
        }
      }
    }

    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;

    let realCandidates: PlaceCandidate[] = [];

    if (googleApiKey && anchor) {
      const coords = { lat: anchor.lat as number, lng: anchor.lng as number };
      const types = ["tourist_attraction", "museum", "park", "amusement_park"];
      const MIN_PER_TYPE = 3;
      const POOL_SIZE = 16;
      // A conditional "widen only if too few nearby" doesn't help when a city
      // centre is dense — every type already clears the minimum within 5km, so
      // the widen step never fires and major outskirts landmarks (Ghibli Park /
      // Legoland Japan are 15-17km from central Nagoya) never get queried at
      // all. Search the full radius directly instead and let Google's own
      // rankPreference: POPULARITY put the well-known ones first.
      // A satellite stop (see isSatelliteStop above) keeps a much tighter radius
      // instead — its own town has too little pull against a nearby major hub's
      // popularity ranking at 20km, so the wide radius would just return the
      // hub city's attractions instead of anything actually near the satellite.
      const SEARCH_RADIUS_M = isSatelliteStop ? 6000 : 20000;

      const isNew = (c: PlaceCandidate) =>
        !currentNames.includes(c.name.toLowerCase().trim()) && !currentPlaceIds.has(c.placeId);

      // isNew only catches an exact name or placeId match — it misses the
      // same physical spot listed twice under different Google place IDs
      // (parks in particular: one pin for the garden, another for an
      // entrance/playground a couple hundred metres away). Reject anything
      // that sits right on top of a stop already on this day, regardless of
      // name/placeId.
      const DUPLICATE_LOCATION_KM = 0.3;
      const isNotDuplicateLocation = (c: PlaceCandidate) =>
        currentCoords.every((s) => haversineKm(s.lat, s.lng, c.lat, c.lng) > DUPLICATE_LOCATION_KM);

      // A satellite town's own attraction pool is thin enough that Google's
      // nearby search — even narrowed to SEARCH_RADIUS_M above — still pulls
      // in a much denser neighboring hub city when the two sit right next to
      // each other (e.g. Raszyn borders Warszawa directly). Matching the
      // candidate's address text against cityHint was tried first but throws
      // out genuinely local candidates in a neighboring village that shares
      // the satellite's postal area but not its name (e.g. Falenty, right
      // next to Raszyn) — observed data put every real Raszyn/Falenty-area
      // candidate within ~1.3km of the anchor stop and every Warszawa one
      // 2.5km+ out, so a tight radius around the anchor separates them
      // cleanly without depending on locality-name text at all.
      const SATELLITE_MAX_KM = 2;
      const isNearAnchor = (c: PlaceCandidate) =>
        !isSatelliteStop || haversineKm(coords.lat, coords.lng, c.lat, c.lng) <= SATELLITE_MAX_KM;

      // Query each type separately and keep a guaranteed slice from every type —
      // a shared search + result cap lets dense types (tourist_attraction) crowd
      // out rare ones (amusement_park) before the rare one is ever considered.
      const seenIds = new Set<string>();
      const guaranteed: PlaceCandidate[] = [];
      const overflow: PlaceCandidate[] = [];

      for (const type of types) {
        // Keep Google's own rankPreference: POPULARITY order instead of
        // re-sorting by star rating — a famous landmark (e.g. 4.1★ Ghibli Park)
        // is what users actually expect here, and a pure rating sort lets
        // obscure-but-higher-rated micro venues (batting cages, kids' indoor
        // playgrounds) push it out of the guaranteed slice.
        const matches = (await fetchNearbyPlaceCandidates(coords, googleApiKey, [type], SEARCH_RADIUS_M, 20))
          .filter(isNew)
          .filter(isNotDuplicateLocation)
          .filter(isNearAnchor)
          .filter((c) => !seenIds.has(c.placeId));

        const kept = matches.slice(0, MIN_PER_TYPE);
        kept.forEach((c) => seenIds.add(c.placeId));
        guaranteed.push(...kept);
        overflow.push(...matches.slice(MIN_PER_TYPE));
      }

      // Fill any remaining pool slots (a type came up short of MIN_PER_TYPE)
      // with leftover candidates across all types, in their original
      // popularity order.
      const remainingSlots = Math.max(0, POOL_SIZE - guaranteed.length);
      const overflowSeen = new Set<string>();
      const extra: PlaceCandidate[] = [];
      for (const c of overflow) {
        if (extra.length >= remainingSlots) break;
        if (seenIds.has(c.placeId) || overflowSeen.has(c.placeId)) continue;
        overflowSeen.add(c.placeId);
        extra.push(c);
      }

      // Fetch a larger pool than a single display batch needs (a "換一批" click
      // pages through this pool client-side instead of re-querying Places/the LLM).
      realCandidates = [...guaranteed, ...extra];
    }

    if (realCandidates.length === 0) {
      const candidates = await suggestFallbackText(model, tripContext, dayTheme, currentNames);
      await logCandidates(candidates);
      return NextResponse.json({ candidates, isFallback: true });
    }

    for (const c of realCandidates) {
      const query = cityHint ? `${c.name} ${cityHint}` : c.name;
      await upsertPlace(query, {
        placeId: c.placeId,
        name: c.name,
        address: c.address,
        lat: c.lat,
        lng: c.lng,
        rating: c.rating ?? null,
        photoName: c.photoName ?? null,
      });
    }

    const candidates: StopCandidate[] = realCandidates.map((c) => ({
      name: c.name,
      description: c.rating ? `靠近您行程中的景點，Google 評分 ${c.rating}★` : "靠近您行程中的景點。",
      duration_minutes: 60,
      placeId: c.placeId,
      lat: c.lat,
      lng: c.lng,
      address: c.address,
      rating: c.rating ?? null,
      photoName: c.photoName ?? null,
    }));

    try {
      const names = realCandidates.map((c) => c.name);
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: `你是專業的旅遊規劃專家。Always respond in Traditional Chinese (繁體中文).
Output strictly valid JSON: { "candidates": [{ "name": string, "description": string, "duration_minutes": number }] }
The "candidates" array MUST have exactly ${names.length} items, in the SAME ORDER, with the EXACT SAME "name" values as given below. Do not add, remove, reorder, or rename any item — only fill in "description" and "duration_minutes" for each.
Names in order: ${names.map((n) => `"${n}"`).join(", ")}`,
          },
          {
            role: "user",
            content: `Trip: ${tripContext}. Day theme: ${dayTheme}. Write a short Traditional Chinese description and a suggested visit duration (minutes) for each of the ${names.length} named places above, in the same order.`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const aiContent = completion.choices[0].message.content;
      if (aiContent) {
        const parsedAI = StopDescriptionFillSchema.safeParse(JSON.parse(aiContent));
        if (parsedAI.success) {
          const normalize = (s: string) => s.toLowerCase().trim();
          for (let i = 0; i < candidates.length; i++) {
            const wantName = normalize(candidates[i].name);
            const byIndex = parsedAI.data.candidates[i];
            const match =
              byIndex && normalize(byIndex.name) === wantName
                ? byIndex
                : parsedAI.data.candidates.find((d) => normalize(d.name) === wantName);
            if (match) {
              candidates[i].description = match.description;
              candidates[i].duration_minutes = match.duration_minutes;
            }
          }
        }
      }
    } catch {
      // keep the generic rating-based fallback descriptions already set above
    }

    const siblings = stops
      .filter((s) => typeof s.lat === "number" && typeof s.lng === "number")
      .map((s) => ({ lat: s.lat as number, lng: s.lng as number }));

    if (siblings.length >= 1) {
      const c = centroid(siblings);
      for (const cand of candidates) {
        if (typeof cand.lat === "number" && typeof cand.lng === "number") {
          const km = haversineKm(cand.lat, cand.lng, c.lat, c.lng);
          if (km > SUSPICIOUS_KM) {
            cand.suspicious = true;
            cand.suspiciousReason = `距同天其他景點約 ${Math.round(km)} km，地點可能不合適`;
          }
        }
      }
    }

    await logCandidates(candidates);
    return NextResponse.json({ candidates, isFallback: false });
  } catch (error) {
    console.error("[Stop Suggestions Error]", error);
    return NextResponse.json(
      { error: "Failed to fetch suggestions", details: String(error) },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { openai } from "@/lib/openai";
import { StopDescriptionFillSchema } from "@/lib/schemas";
import type { StopCandidate } from "@/types/itinerary";
import { getMockMode, mockDelay, MOCK_FIXTURES } from "@/lib/mockAi";
import { fetchNearbyPlaceCandidates, type PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { upsertPlace } from "@/lib/placeCache";
import { haversineKm } from "@/lib/distanceMatrix";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
  context: z.string().optional(),
  excludeNames: z.array(z.string()).optional(),
});

// If a candidate is >80km from the centroid of the day's remaining stops,
// it's likely a bad match — same heuristic as enrich-all-stops/route.ts.
const SUSPICIOUS_KM = 80;

function centroid(pts: { lat: number; lng: number }[]): { lat: number; lng: number } {
  const sum = pts.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / pts.length, lng: sum.lng / pts.length };
}

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

    const { itineraryId, context, excludeNames } = parsed.data;

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
    const dayIndex = days.findIndex((d) => d.id === dayId);
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

    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const tripContext = context ?? itinerary.title;
    const dayTheme = typeof day.theme === "string" ? day.theme : "";
    const cityHint =
      (typeof day.waypointCity === "string" ? day.waypointCity : "") ||
      (typeof day.transitTo === "string" ? day.transitTo : "") ||
      "";

    let anchor = stops.find(
      (s) => typeof s.lat === "number" && typeof s.lng === "number"
    );

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
      const SEARCH_RADIUS_M = 20000;

      const isNew = (c: PlaceCandidate) =>
        !currentNames.includes(c.name.toLowerCase().trim()) && !currentPlaceIds.has(c.placeId);

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

    return NextResponse.json({ candidates, isFallback: false });
  } catch (error) {
    console.error("[Stop Suggestions Error]", error);
    return NextResponse.json(
      { error: "Failed to fetch suggestions", details: String(error) },
      { status: 500 }
    );
  }
}

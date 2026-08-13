import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { getMockMode, mockDelay, MOCK_FIXTURES } from "@/lib/mockAi";
import {
  fetchNearbyPlaceCandidates,
  findNearestStation,
  getLodgingTypes,
  getPriceLevels,
} from "@/lib/fetchCityRestaurants";
import { resolveDayCoords } from "@/lib/itineraryGen";
import { estimateLodgingCostPerNight, estimateLodgingCostRange } from "@/lib/priceLevelCost";
import type { AccommodationCandidate } from "@/types/itinerary";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
});

// Google's formattedAddress is typically "<street>, <district/city>, <region>
// <postal>, <country>" — the 2nd segment is the closest approximation of a
// short "area" label we can derive without another API call.
function deriveArea(address: string): string {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts[1] ?? parts[0] ?? address;
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

    const { itineraryId } = parsed.data;

    const mockMode = getMockMode();
    if (mockMode === "error") {
      return NextResponse.json({ error: "Mock AI error (MOCK_AI=error)" }, { status: 500 });
    }
    if (mockMode === "slow" || mockMode === "fixture") {
      await mockDelay(mockMode === "slow" ? 3500 : 0);
      return NextResponse.json({ success: true, candidates: MOCK_FIXTURES.accommodationCandidates });
    }

    const itinerary = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
    });

    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const dayIndex = days.findIndex((d) => d.id === dayId);

    if (dayIndex === -1) {
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }

    const day = days[dayIndex];
    const currentAccommodation = day.accommodation as Record<string, unknown> | undefined;

    const config = itinerary.config as {
      flightInfo?: { arrivalCity?: string };
      preferences?: { budget?: "budget" | "moderate" | "luxury" };
      currency?: string;
    };
    const budget = config.preferences?.budget;

    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!googleApiKey) {
      return NextResponse.json({ error: "住宿搜尋功能未設定" }, { status: 503 });
    }

    const coords = resolveDayCoords(days, day, config.flightInfo?.arrivalCity);

    if (!coords) {
      return NextResponse.json(
        { error: "無法定位這天的住宿搜尋範圍，請先為景點補上地點資料" },
        { status: 422 }
      );
    }

    const lodgingTypes = getLodgingTypes(budget);
    const priceLevels = getPriceLevels(budget);

    let hotels = await fetchNearbyPlaceCandidates(coords, googleApiKey, lodgingTypes, 3000, 10, priceLevels);
    if (hotels.length === 0 && priceLevels) {
      // Small destinations often don't tag price level on lodging listings —
      // retry without the price filter rather than coming back empty.
      hotels = await fetchNearbyPlaceCandidates(coords, googleApiKey, lodgingTypes, 3000, 10);
    }

    const currentPlaceId =
      typeof currentAccommodation?.placeId === "string" ? currentAccommodation.placeId : undefined;
    const currentName =
      typeof currentAccommodation?.name === "string" ? currentAccommodation.name : undefined;
    const normalize = (s: string) => s.toLowerCase().trim();

    const filteredHotels = hotels.filter(
      (h) =>
        h.placeId !== currentPlaceId &&
        (!currentName || normalize(h.name) !== normalize(currentName))
    );

    // One Nearby Search per candidate to find its closest station — kept to
    // the filtered list (not the raw `hotels`) so we don't spend calls on
    // entries that get dropped anyway.
    const nearestStations = await Promise.all(
      filteredHotels.map((h) => findNearestStation({ lat: h.lat, lng: h.lng }, googleApiKey))
    );

    const newCandidates: AccommodationCandidate[] = filteredHotels.map((h, i) => {
      const estimatedCost = estimateLodgingCostPerNight(config.currency, h.priceLevel);
      const costRange = estimateLodgingCostRange(config.currency, h.priceLevel);
      return {
        name: h.name,
        area: deriveArea(h.address),
        placeId: h.placeId,
        lat: h.lat,
        lng: h.lng,
        address: h.address,
        rating: h.rating ?? null,
        priceLevel: h.priceLevel ?? null,
        ...(estimatedCost !== undefined ? { estimated_cost: estimatedCost } : {}),
        ...(costRange !== undefined
          ? { estimated_cost_low: costRange[0], estimated_cost_high: costRange[1] }
          : {}),
        nearestStation: nearestStations[i],
        photoName: h.photoName ?? null,
      };
    });

    // Surface the day's existing accommodation as the first candidate so
    // picking it again (i.e. "keep what I had") costs nothing extra.
    const candidates: AccommodationCandidate[] = currentName
      ? [
          {
            name: currentName,
            area: typeof currentAccommodation?.area === "string" ? currentAccommodation.area : "",
            placeId: currentPlaceId,
            lat: typeof currentAccommodation?.lat === "number" ? currentAccommodation.lat : undefined,
            lng: typeof currentAccommodation?.lng === "number" ? currentAccommodation.lng : undefined,
            address:
              typeof currentAccommodation?.address === "string" ? currentAccommodation.address : undefined,
            rating: typeof currentAccommodation?.rating === "number" ? currentAccommodation.rating : null,
            estimated_cost:
              typeof currentAccommodation?.estimated_cost === "number"
                ? currentAccommodation.estimated_cost
                : undefined,
            estimated_cost_low:
              typeof currentAccommodation?.estimated_cost_low === "number"
                ? currentAccommodation.estimated_cost_low
                : undefined,
            estimated_cost_high:
              typeof currentAccommodation?.estimated_cost_high === "number"
                ? currentAccommodation.estimated_cost_high
                : undefined,
            photoName:
              typeof currentAccommodation?.photoName === "string" ? currentAccommodation.photoName : null,
            isCurrent: true,
          },
          ...newCandidates,
        ]
      : newCandidates;

    // Keep a full history of every candidate batch shown for this day, even
    // after the user picks a different one, so it can be reviewed later.
    await prisma.accommodationCandidateLog.create({
      data: { itineraryId, dayId, candidates: j(candidates) },
    });

    return NextResponse.json({ success: true, candidates });
  } catch (error) {
    console.error("[Accommodation Candidates Error]", error);
    return NextResponse.json(
      { error: "Failed to fetch accommodation candidates", details: String(error) },
      { status: 500 }
    );
  }
}

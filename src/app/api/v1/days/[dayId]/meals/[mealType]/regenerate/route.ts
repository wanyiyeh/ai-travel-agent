import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { getMockMode, mockDelay, MOCK_FIXTURES } from "@/lib/mockAi";
import {
  fetchNearbyPlaceCandidates,
  getMealPlaceTypes,
  getPriceLevels,
} from "@/lib/fetchCityRestaurants";
import { resolveDayCoords } from "@/lib/itineraryGen";
import { estimateMealCost } from "@/lib/priceLevelCost";
import { isMealType } from "@/types/itinerary";
import type { MealCandidate } from "@/types/itinerary";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dayId: string; mealType: string }> }
) {
  try {
    const { dayId, mealType } = await params;
    if (!isMealType(mealType)) {
      return NextResponse.json({ error: "Invalid meal type" }, { status: 400 });
    }

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
      return NextResponse.json({ success: true, candidates: MOCK_FIXTURES.mealCandidates });
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
    const meals = day.meals as Record<string, Record<string, unknown>> | undefined;
    const currentMeal = meals?.[mealType];

    const config = itinerary.config as {
      flightInfo?: { arrivalCity?: string };
      preferences?: { budget?: "budget" | "moderate" | "luxury" };
      currency?: string;
    };
    const budget = config.preferences?.budget;

    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!googleApiKey) {
      return NextResponse.json({ error: "餐廳搜尋功能未設定" }, { status: 503 });
    }

    const coords = resolveDayCoords(days, day, config.flightInfo?.arrivalCity);

    if (!coords) {
      return NextResponse.json(
        { error: "無法定位這天的餐廳搜尋範圍，請先為景點補上地點資料" },
        { status: 422 }
      );
    }

    const types = getMealPlaceTypes(mealType, budget);
    const priceLevels = getPriceLevels(budget);

    let places = await fetchNearbyPlaceCandidates(coords, googleApiKey, types, 2000, 10, priceLevels);
    if (places.length === 0 && priceLevels) {
      // Small destinations often don't tag price level on dining listings —
      // retry without the price filter rather than coming back empty.
      places = await fetchNearbyPlaceCandidates(coords, googleApiKey, types, 2000, 10);
    }

    const currentPlaceId =
      typeof currentMeal?.placeId === "string" ? currentMeal.placeId : undefined;
    const currentName = typeof currentMeal?.name === "string" ? currentMeal.name : undefined;
    const normalize = (s: string) => s.toLowerCase().trim();

    const newCandidates: MealCandidate[] = places
      .filter(
        (p) =>
          p.placeId !== currentPlaceId &&
          (!currentName || normalize(p.name) !== normalize(currentName))
      )
      .map((p) => ({
        name: p.name,
        placeId: p.placeId,
        lat: p.lat,
        lng: p.lng,
        address: p.address,
        rating: p.rating ?? null,
        estimated_cost: estimateMealCost(config.currency, mealType, p.priceLevel),
      }));

    // Surface the day's existing meal as the first candidate so picking it
    // again (i.e. "keep what I had") costs nothing extra.
    const candidates: MealCandidate[] = currentName
      ? [
          {
            name: currentName,
            description:
              typeof currentMeal?.description === "string" ? currentMeal.description : undefined,
            estimated_cost:
              typeof currentMeal?.estimated_cost === "number" ? currentMeal.estimated_cost : undefined,
            placeId: currentPlaceId,
            lat: typeof currentMeal?.lat === "number" ? currentMeal.lat : undefined,
            lng: typeof currentMeal?.lng === "number" ? currentMeal.lng : undefined,
            address: typeof currentMeal?.address === "string" ? currentMeal.address : undefined,
            rating: typeof currentMeal?.rating === "number" ? currentMeal.rating : null,
            isCurrent: true,
          },
          ...newCandidates,
        ]
      : newCandidates;

    // Keep a full history of every candidate batch shown for this meal slot,
    // even after the user picks a different one, so it can be reviewed later.
    await prisma.mealCandidateLog.create({
      data: { itineraryId, dayId, mealType, candidates: j(candidates) },
    });

    return NextResponse.json({ success: true, candidates });
  } catch (error) {
    console.error("[Meal Candidates Error]", error);
    return NextResponse.json(
      { error: "Failed to fetch meal candidates", details: String(error) },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { getMockMode, mockDelay, MOCK_FIXTURES } from "@/lib/mockAi";
import {
  fetchLuxuryRestaurants,
  fetchNearbyPlaceCandidates,
  getMealPlaceTypes,
} from "@/lib/fetchCityRestaurants";
import { snapToGrid } from "@/lib/geo";
import { resolveDayCoords } from "@/lib/itineraryGen";
import { estimateMealCost } from "@/lib/priceLevelCost";
import { isFoodPlace } from "@/lib/foodPlace";
import { fitsCafeMealSlot, fitsMainMeal } from "@/lib/cafeMealSlots";
import { dietRequiredTypes, excludeByDiet } from "@/lib/dietaryFilter";
import { TripPreferencesSchema } from "@/lib/schemas";
import { plannedLabel, plannedSlotsByPlace } from "@/lib/mealRepeats";
import { getTwdRates } from "@/lib/exchangeRate";
import { estimateFromPriceRange, rankMainMealsByBudget } from "@/lib/mealBudget";

// How many fresh candidates the picker shows.
const PICKER_SIZE = 10;
import { translatePlaceNames } from "@/lib/translatePlaceNames";
import { isMealType } from "@/types/itinerary";
import { findDayIndex } from "@/lib/itineraryDays";
import type { MealCandidate } from "@/types/itinerary";
import { internalErrorResponse } from "@/lib/apiError";
import { authorizeItinerary } from "@/lib/auth/ownership";
import { chargePaidEdit } from "@/lib/quota";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
});

// The 換一家 picker's search center is the day's own stops, which differ
// every day — snapped to a ~1km grid (geo.ts snapToGrid) so nearby days share
// one cached pool. A 2-3km radius barely changes when the center moves <=~550m.
const PICKER_SEARCH_GRID_DEG = 0.01;

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

    const access = await authorizeItinerary(itineraryId);
    if (!access.ok) return access.response;
    const { itinerary } = access;
    // Paid edit: counts against the caller's daily quota (plan/access-control.md §2).
    const charged = await chargePaidEdit(request, access.actor, itineraryId);
    if (charged) return charged;

    const mockMode = getMockMode();
    if (mockMode === "error") {
      return NextResponse.json({ error: "Mock AI error (MOCK_AI=error)" }, { status: 500 });
    }
    if (mockMode === "slow" || mockMode === "fixture") {
      await mockDelay(mockMode === "slow" ? 3500 : 0);
      return NextResponse.json({ success: true, candidates: MOCK_FIXTURES.mealCandidates });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const dayIndex = findDayIndex(days, dayId);

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
    // Only lunch/dinner needs Enterprise fields (budget ranking reads
    // priceRange); breakfast/snack have no budget cap (plan/form-preference-wiring.md 1c-2).
    const isMainMeal = mealType === "lunch" || mealType === "dinner";
    const tier = isMainMeal ? "enterprise" : "pro";

    // Form-chosen restrictions only — the free-text parse isn't stored with
    // the itinerary (plan/form-preference-wiring.md 1d).
    const diet = TripPreferencesSchema.shape.dietaryRestrictions.safeParse(
      (config.preferences as { dietaryRestrictions?: unknown } | undefined)?.dietaryRestrictions
    ).data ?? [];
    // Vegetarian/vegan/halal lunch & dinner: restaurants of exactly that type first.
    const dietTypes = isMainMeal ? dietRequiredTypes(diet) : [];
    const center = snapToGrid(coords, PICKER_SEARCH_GRID_DEG);

    // Pull the full cached pool (same cost as 10 — see NEARBY_FETCH_COUNT) so
    // dropping non-food places still leaves up to 10 to show.
    const [pool, dietPool, luxuryPool] = await Promise.all([
      fetchNearbyPlaceCandidates(center, googleApiKey, types, 2000, 20, tier),
      dietTypes.length > 0 ? fetchNearbyPlaceCandidates(center, googleApiKey, dietTypes, 2000, 20, tier) : Promise.resolve([]),
      // The popularity-ranked pool has few expensive places; see fetchLuxuryRestaurants.
      isMainMeal && budget === "luxury" ? fetchLuxuryRestaurants(center, googleApiKey, 2000) : Promise.resolve([]),
    ]);
    const seen = new Set<string>();
    const merged = [...dietPool, ...luxuryPool, ...pool].filter((p) => !seen.has(p.placeId) && seen.add(p.placeId));
    const foodPlaces = excludeByDiet(merged, diet)
      .filter(isFoodPlace)
      // Breakfast and snack share one café search; keep what suits this slot.
      .filter((p) => (isMainMeal ? fitsMainMeal(p) : fitsCafeMealSlot(p, mealType as "breakfast" | "snack")));
    // Lunch/dinner: in-budget restaurants first (plan/form-preference-wiring.md 1.3).
    const ranked =
      isMainMeal && budget
        ? rankMainMealsByBudget(foodPlaces, budget, config.currency, await getTwdRates(), PICKER_SIZE)
        : foodPlaces;
    const places = ranked.slice(0, PICKER_SIZE);

    const currentPlaceId =
      typeof currentMeal?.placeId === "string" ? currentMeal.placeId : undefined;
    const currentName = typeof currentMeal?.name === "string" ? currentMeal.name : undefined;
    const normalize = (s: string) => s.toLowerCase().trim();

    const filteredPlaces = places.filter(
      (p) =>
        p.placeId !== currentPlaceId &&
        (!currentName || normalize(p.name) !== normalize(currentName))
    );

    // Google's zh-TW languageCode only translates names it already has a
    // Chinese listing for — most independent restaurants/cafés (especially
    // in Japan) come back in the local script, so fill the gap for display.
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const nameTranslations = await translatePlaceNames(
      filteredPlaces.map((p) => p.name),
      model,
    );

    // Places already planned for another meal of this trip are labelled and
    // moved to the end, so swapping out a repeat doesn't just land on another.
    // Labelled rather than dropped: candidates can be scarce, and some
    // travelers do want to go back somewhere.
    const dayNumber = typeof day.day === "number" ? day.day : dayIndex + 1;
    const plannedElsewhere = plannedSlotsByPlace(days, { day: dayNumber, mealType });
    const newCandidates: MealCandidate[] = filteredPlaces
      .map((p) => {
        const planned = plannedElsewhere.get(p.placeId);
        return {
          name: nameTranslations.get(p.name) ?? p.name,
          placeId: p.placeId,
          lat: p.lat,
          lng: p.lng,
          address: p.address,
          rating: p.rating ?? null,
          estimated_cost:
            estimateFromPriceRange(p.priceRange, config.currency) ?? estimateMealCost(config.currency, mealType, p.priceLevel),
          photoName: p.photoName ?? null,
          ...(planned ? { plannedElsewhere: plannedLabel(planned) } : {}),
        };
      })
      .sort((a, b) => Number(Boolean(a.plannedElsewhere)) - Number(Boolean(b.plannedElsewhere)));

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
            photoName: typeof currentMeal?.photoName === "string" ? currentMeal.photoName : null,
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
    return internalErrorResponse("Meal Candidates Error", error, "Failed to fetch meal candidates");
  }
}

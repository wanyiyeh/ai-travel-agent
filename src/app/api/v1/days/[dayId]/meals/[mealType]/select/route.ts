import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { MealSchema } from "@/lib/schemas";
import { getMockMode, mockDelay } from "@/lib/mockAi";
import { isMealType } from "@/types/itinerary";
import { upsertPlace } from "@/lib/placeCache";
import { findDayIndex } from "@/lib/itineraryDays";
import { internalErrorResponse } from "@/lib/apiError";
import { authorizeItinerary } from "@/lib/auth/ownership";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
  meal: MealSchema,
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

    const { itineraryId, meal } = parsed.data;

    const mockMode = getMockMode();
    if (mockMode === "error") {
      return NextResponse.json({ error: "Mock AI error (MOCK_AI=error)" }, { status: 500 });
    }
    // No AI/Places calls happen in this route (the candidate was already
    // fetched by /regenerate) — "slow" just adds latency for spinner testing,
    // "fixture" behaves identically to the real path since there's nothing to fake.
    if (mockMode === "slow") {
      await mockDelay(1500);
    }

    const access = await authorizeItinerary(itineraryId);
    if (!access.ok) return access.response;
    const { itinerary } = access;

    const days = itinerary.days as Record<string, unknown>[];
    const dayIndex = findDayIndex(days, dayId);

    if (dayIndex === -1) {
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }

    const day = days[dayIndex];
    // A reservation (固定行程) stands: its price can be edited, not the place.
    // The meal schema has no fixedEvent, so it's carried over from the stored
    // meal — a price edit used to drop it, and 換一家 came back.
    const current = (day.meals as Record<string, Record<string, unknown> | undefined> | undefined)?.[mealType];
    const sameMeal = (other: typeof meal) =>
      current !== undefined && (other.placeId ? other.placeId === current.placeId : other.name === current.name);
    if (current?.fixedEvent && !sameMeal(meal)) {
      return NextResponse.json({ error: "訂好位的餐廳不能換成別家" }, { status: 400 });
    }
    const saved = current?.fixedEvent ? { ...meal, fixedEvent: current.fixedEvent } : meal;

    if (meal.placeId && meal.lat != null && meal.lng != null) {
      await upsertPlace(meal.name, {
        placeId: meal.placeId,
        name: meal.name,
        address: meal.address ?? null,
        lat: meal.lat,
        lng: meal.lng,
        rating: meal.rating ?? null,
        photoName: meal.photoName ?? null,
      });
    }
    const meals = { ...(day.meals as Record<string, unknown> | undefined), [mealType]: saved };
    days[dayIndex] = { ...day, meals };

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ success: true, meal: saved });
  } catch (error) {
    return internalErrorResponse("Meal Select Error", error, "Failed to select meal");
  }
}

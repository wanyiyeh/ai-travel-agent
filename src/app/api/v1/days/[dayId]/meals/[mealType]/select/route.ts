import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { MealSchema } from "@/lib/schemas";
import { getMockMode, mockDelay } from "@/lib/mockAi";
import { isMealType } from "@/types/itinerary";
import { upsertPlace } from "@/lib/placeCache";

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

    if (meal.placeId && meal.lat != null && meal.lng != null) {
      await upsertPlace(meal.name, {
        placeId: meal.placeId,
        name: meal.name,
        address: meal.address ?? null,
        lat: meal.lat,
        lng: meal.lng,
        rating: meal.rating ?? null,
      });
    }

    const day = days[dayIndex];
    const meals = { ...(day.meals as Record<string, unknown> | undefined), [mealType]: meal };
    days[dayIndex] = { ...day, meals };

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ success: true, meal });
  } catch (error) {
    console.error("[Meal Select Error]", error);
    return NextResponse.json(
      { error: "Failed to select meal", details: String(error) },
      { status: 500 }
    );
  }
}

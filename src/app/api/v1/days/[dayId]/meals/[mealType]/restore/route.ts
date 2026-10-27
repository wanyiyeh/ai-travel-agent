import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { isMealType } from "@/types/itinerary";
import { findDayIndex } from "@/lib/itineraryDays";
import { internalErrorResponse } from "@/lib/apiError";
import { authorizeItinerary } from "@/lib/auth/ownership";
import { unskipMeal } from "@/lib/skippedMeals";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
});

/** Brings a deleted meal back as an empty slot to pick from (ADR-0010). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ dayId: string; mealType: string }> }
) {
  try {
    const { dayId, mealType } = await params;
    if (!isMealType(mealType)) {
      return NextResponse.json({ error: "Invalid meal type" }, { status: 400 });
    }
    const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const { itineraryId } = parsed.data;

    const access = await authorizeItinerary(itineraryId);
    if (!access.ok) return access.response;
    const days = access.itinerary.days as Record<string, unknown>[];
    const dayIndex = findDayIndex(days, dayId);
    if (dayIndex === -1) {
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }

    days[dayIndex] = unskipMeal(days[dayIndex], mealType);
    await prisma.itinerary.update({ where: { id: itineraryId }, data: { days: j(days) } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return internalErrorResponse("Meal Restore Error", error, "Failed to restore meal");
  }
}

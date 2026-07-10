import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isMealType } from "@/types/itinerary";
import type { MealCandidate } from "@/types/itinerary";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ dayId: string; mealType: string }> }
) {
  try {
    const { dayId, mealType } = await params;
    if (!isMealType(mealType)) {
      return NextResponse.json({ error: "Invalid meal type" }, { status: 400 });
    }

    const itineraryId = new URL(request.url).searchParams.get("itineraryId");

    if (!itineraryId) {
      return NextResponse.json({ error: "itineraryId is required" }, { status: 400 });
    }

    const logs = await prisma.mealCandidateLog.findMany({
      where: { itineraryId, dayId, mealType },
      orderBy: { createdAt: "desc" },
    });

    const history = logs.map((log) => ({
      id: log.id,
      createdAt: log.createdAt,
      candidates: JSON.parse(log.candidates) as MealCandidate[],
    }));

    return NextResponse.json({ success: true, history });
  } catch (error) {
    console.error("[Meal Candidates History Error]", error);
    return NextResponse.json(
      { error: "Failed to fetch meal candidate history", details: String(error) },
      { status: 500 }
    );
  }
}

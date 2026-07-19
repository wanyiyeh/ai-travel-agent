import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";

const RequestSchema = z.discriminatedUnion("isTransitDay", [
  z.object({
    itineraryId: z.string().min(1),
    isTransitDay: z.literal(true),
    transitTo: z.string().min(1),
  }),
  z.object({
    itineraryId: z.string().min(1),
    isTransitDay: z.literal(false),
  }),
]);

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

    const { itineraryId, isTransitDay } = parsed.data;

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

    // Transit days carry no accommodation — mirrors the AI-generated shape
    // enforced by validateItinerary's TRANSIT_DAY_HAS_ACCOMMODATION rule.
    days[dayIndex] = isTransitDay
      ? { ...days[dayIndex], isTransitDay: true, transitTo: parsed.data.transitTo, accommodation: null }
      : { ...days[dayIndex], isTransitDay: false, transitTo: undefined };

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ success: true, day: days[dayIndex] });
  } catch (error) {
    console.error("[Toggle Transit Day Error]", error);
    return NextResponse.json(
      { error: "Failed to toggle transit day", details: String(error) },
      { status: 500 }
    );
  }
}

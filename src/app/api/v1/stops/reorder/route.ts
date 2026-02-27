import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { itineraryId, days: reorderDays } = body;

    if (!itineraryId || !reorderDays) {
      return NextResponse.json(
        { error: "itineraryId and days are required" },
        { status: 400 }
      );
    }

    const itinerary = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
    });

    if (!itinerary) {
      return NextResponse.json(
        { error: "Itinerary not found" },
        { status: 404 }
      );
    }

    const days = itinerary.days as Record<string, unknown>[];

    for (const reorderDay of reorderDays as {
      dayId: string;
      stopIds: string[];
    }[]) {
      const { dayId, stopIds } = reorderDay;
      const day = days.find((d) => d.id === dayId);
      if (!day) continue;

      const stops = day.stops as Record<string, unknown>[];
      const stopMap = new Map(stops.map((s) => [s.id, s]));
      day.stops = stopIds
        .map((id) => stopMap.get(id))
        .filter(Boolean)
        .map((s, idx) => ({ ...(s as object), orderIndex: idx }));
    }

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: days as object[] },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Reorder Error]", error);
    return NextResponse.json({ error: "Failed to reorder" }, { status: 500 });
  }
}

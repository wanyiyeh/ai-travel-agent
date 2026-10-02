import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { MAX_NAME_LENGTH, MAX_NAME_LIST_LENGTH } from "@/lib/inputLimits";

const id = z.string().min(1).max(MAX_NAME_LENGTH);

// The client sends every day of the trip, each with its full stop-id order.
// Day count is checked loosely (older itineraries predate MAX_TRIP_DAYS);
// the point is a bounded, well-typed shape rather than trusting `as` casts.
const RequestSchema = z.object({
  itineraryId: id,
  days: z
    .array(z.object({ dayId: id, stopIds: z.array(id).max(MAX_NAME_LIST_LENGTH) }))
    .max(MAX_NAME_LIST_LENGTH),
});

export async function POST(request: Request) {
  try {
    const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { itineraryId, days: reorderDays } = parsed.data;

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

    // A stop may have been dragged to a different day than the one it lives
    // under in the DB, so look it up across the whole itinerary rather than
    // just the day it's being reassigned to — otherwise a cross-day move
    // silently drops the stop (its data only exists under its old day).
    const globalStopMap = new Map<string, Record<string, unknown>>();
    for (const day of days) {
      for (const stop of day.stops as Record<string, unknown>[]) {
        if (stop.id) globalStopMap.set(stop.id as string, stop);
      }
    }

    for (const reorderDay of reorderDays) {
      const { dayId, stopIds } = reorderDay;
      const day = days.find((d) => d.id === dayId);
      if (!day) continue;

      day.stops = stopIds
        .map((id) => globalStopMap.get(id))
        .filter(Boolean)
        .map((s, idx) => ({ ...(s as object), orderIndex: idx }));
    }

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Reorder Error]", error);
    return NextResponse.json({ error: "Failed to reorder" }, { status: 500 });
  }
}

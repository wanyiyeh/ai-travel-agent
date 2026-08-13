import { NextResponse } from "next/server";
import { prisma, j } from "@/lib/db";

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

    // A stop may have been dragged to a different day than the one it lives
    // under in the DB, so look it up across the whole itinerary rather than
    // just the day it's being reassigned to — otherwise a cross-day move
    // silently drops the stop (its data only exists under its old day).
    const globalStopMap = new Map<string, Record<string, unknown>>();
    // Stops belonging to a locked day can never be dragged into/out of it —
    // track their ids so they get stripped from any other day's target list.
    const lockedStopIds = new Set<string>();
    for (const day of days) {
      for (const stop of day.stops as Record<string, unknown>[]) {
        if (stop.id) globalStopMap.set(stop.id as string, stop);
        if (stop.id && day.isLocked === true) lockedStopIds.add(stop.id as string);
      }
    }

    for (const reorderDay of reorderDays as {
      dayId: string;
      stopIds: string[];
    }[]) {
      const { dayId, stopIds } = reorderDay;
      const day = days.find((d) => d.id === dayId);
      if (!day) continue;
      if (day.isLocked === true) continue; // locked day's single stop never reorders

      day.stops = stopIds
        .filter((id) => !lockedStopIds.has(id))
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

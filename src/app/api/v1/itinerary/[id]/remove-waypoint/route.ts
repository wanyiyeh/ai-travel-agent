import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";

const RequestSchema = z.object({
  transitTo: z.string().min(1),
});

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: itineraryId } = await params;
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { transitTo } = parsed.data;

    const itinerary = await prisma.itinerary.findUnique({ where: { id: itineraryId } });
    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];

    // Use !! so truthy values (e.g. 1) stored by older code also match
    const transitIdx = days.findIndex(
      (d) => !!d.isTransitDay && d.transitTo === transitTo
    );
    if (transitIdx === -1) {
      return NextResponse.json({ error: "Waypoint not found" }, { status: 404 });
    }

    // Collect stay days that belong to this waypoint.
    // New days carry waypointCity; legacy days fall back to an exact theme match.
    let endIdx = transitIdx + 1;
    while (endIdx < days.length && !days[endIdx].isTransitDay) {
      const d = days[endIdx];
      // d.waypointCity != null covers both null and undefined
      if (d.waypointCity != null) {
        if (d.waypointCity !== transitTo) break;
      } else {
        // Legacy: stay days were given theme `${cityName} 探索`
        if (d.theme !== `${transitTo} 探索`) break;
      }
      endIdx++;
    }

    const removedTransitDay = days[transitIdx];

    // Prefer full after-block restoration (batch-insert path) over per-transit-day fallback
    const originalAfter = removedTransitDay._originalAfter as Record<string, unknown>[] | null | undefined;
    const originalNextTransitStops = removedTransitDay._originalNextTransitStops as unknown[] | null | undefined;

    let sliced: Record<string, unknown>[];

    if (Array.isArray(originalAfter) && originalAfter.length > 0) {
      // Full restoration: replace everything after the removed block with the saved snapshot
      sliced = [...days.slice(0, transitIdx), ...originalAfter];
    } else {
      sliced = [...days.slice(0, transitIdx), ...days.slice(endIdx)];

      // Partial restoration: fix only the next transit day's stops (single insert-waypoint path)
      if (
        Array.isArray(originalNextTransitStops) &&
        originalNextTransitStops.length > 0 &&
        sliced[transitIdx]?.isTransitDay
      ) {
        sliced = [
          ...sliced.slice(0, transitIdx),
          { ...sliced[transitIdx], stops: originalNextTransitStops },
          ...sliced.slice(transitIdx + 1),
        ];
      }
    }

    const updatedDays = sliced.map((d, i) => ({ ...d, day: i + 1 }));

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(updatedDays) },
    });

    return NextResponse.json({ success: true, removedDays: endIdx - transitIdx });
  } catch (error) {
    console.error("[Remove Waypoint Error]", error);
    return NextResponse.json({ error: "Failed to remove waypoint" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma, j } from "@/lib/db";
import { authorizeItinerary } from "@/lib/auth/ownership";

// Mirrors trash/[deletedStopId]/restore/route.ts — reinserts a trashed whole
// day at its original position and renumbers the day sequence.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; deletedDayId: string }> }
) {
  try {
    const { id, deletedDayId } = await params;

    // Ownership first, so a non-owner can't tell whether a trash id exists.
    const access = await authorizeItinerary(id);
    if (!access.ok) return access.response;
    const { itinerary } = access;

    const entry = await prisma.deletedDay.findUnique({ where: { id: deletedDayId } });
    if (!entry || entry.itineraryId !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const restoredDay = JSON.parse(entry.day) as Record<string, unknown>;
    const insertAt = Math.min(entry.originalIndex, days.length);
    days.splice(insertAt, 0, restoredDay);

    const renumbered = days.map((d, i) => ({ ...d, day: i + 1 }));

    await prisma.$transaction([
      prisma.itinerary.update({
        where: { id },
        data: { days: j(renumbered) },
      }),
      prisma.deletedDay.delete({ where: { id: deletedDayId } }),
    ]);

    return NextResponse.json({ success: true, day: restoredDay });
  } catch (error) {
    console.error("[Trash Day Restore Error]", error);
    return NextResponse.json({ error: "Failed to restore day" }, { status: 500 });
  }
}

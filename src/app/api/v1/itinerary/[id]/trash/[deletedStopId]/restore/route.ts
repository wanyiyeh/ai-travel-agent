import { NextResponse } from "next/server";
import { prisma, j } from "@/lib/db";
import type { Stop } from "@/types/itinerary";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; deletedStopId: string }> }
) {
  try {
    const { id, deletedStopId } = await params;

    const entry = await prisma.deletedStop.findUnique({ where: { id: deletedStopId } });
    if (!entry || entry.itineraryId !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const itinerary = await prisma.itinerary.findUnique({ where: { id } });
    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const day = days.find((d) => d.id === entry.dayId);
    if (!day) {
      return NextResponse.json(
        { error: "原本的日期已不存在，無法復原" },
        { status: 409 }
      );
    }

    const stop = JSON.parse(entry.stop) as Stop;
    const stops = day.stops as Record<string, unknown>[];
    const insertAt = Math.min(entry.originalIndex, stops.length);
    stops.splice(insertAt, 0, stop as unknown as Record<string, unknown>);

    await prisma.$transaction([
      prisma.itinerary.update({
        where: { id },
        data: { days: j(days) },
      }),
      prisma.deletedStop.delete({ where: { id: deletedStopId } }),
    ]);

    return NextResponse.json({ success: true, stop, dayId: entry.dayId });
  } catch (error) {
    console.error("[Trash Restore Error]", error);
    return NextResponse.json({ error: "Failed to restore" }, { status: 500 });
  }
}

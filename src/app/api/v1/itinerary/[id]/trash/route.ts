import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Stop } from "@/types/itinerary";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const entries = await prisma.deletedStop.findMany({
      where: { itineraryId: id },
      orderBy: { deletedAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      entries: entries.map((entry) => ({
        id: entry.id,
        dayId: entry.dayId,
        dayNumber: entry.dayNumber,
        deletedAt: entry.deletedAt,
        stop: JSON.parse(entry.stop) as Stop,
      })),
    });
  } catch (error) {
    console.error("[Trash GET Error]", error);
    return NextResponse.json({ error: "Failed to fetch trash" }, { status: 500 });
  }
}

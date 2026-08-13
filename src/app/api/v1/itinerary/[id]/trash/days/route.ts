import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { DayWithId } from "@/types/itinerary";

// Mirrors trash/route.ts (per-stop trash) but lists whole-day entries
// created by the restructure flow when it shrinks a city's day count.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const entries = await prisma.deletedDay.findMany({
      where: { itineraryId: id },
      orderBy: { deletedAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      entries: entries.map((entry) => ({
        id: entry.id,
        deletedAt: entry.deletedAt,
        day: JSON.parse(entry.day) as DayWithId,
      })),
    });
  } catch (error) {
    console.error("[Trash Days GET Error]", error);
    return NextResponse.json({ error: "Failed to fetch trashed days" }, { status: 500 });
  }
}

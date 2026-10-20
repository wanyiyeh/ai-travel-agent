import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { DayWithId } from "@/types/itinerary";
import { authorizeItinerary } from "@/lib/auth/ownership";
import { hydrateDays } from "@/lib/placeDisplay";
import { runMetered } from "@/lib/usageMeter";

// Mirrors trash/route.ts (per-stop trash) but lists whole-day entries
// created by the restructure flow when it shrinks a city's day count.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await authorizeItinerary(id);
    if (!access.ok) return access.response;

    const entries = await prisma.deletedDay.findMany({
      where: { itineraryId: id },
      orderBy: { deletedAt: "desc" },
    });

    const list = entries.map((entry) => ({
      id: entry.id,
      deletedAt: entry.deletedAt,
      day: JSON.parse(entry.day) as DayWithId,
    }));
    // Trash keeps place IDs only (ADR-0004): names come back from Google.
    await runMetered("hydrate", () => hydrateDays(list.map((entry) => entry.day), "all"));

    return NextResponse.json({ success: true, entries: list });
  } catch (error) {
    console.error("[Trash Days GET Error]", error);
    return NextResponse.json({ error: "Failed to fetch trashed days" }, { status: 500 });
  }
}

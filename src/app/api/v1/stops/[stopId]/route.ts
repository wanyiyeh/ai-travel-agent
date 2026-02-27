import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ stopId: string }> }
) {
  try {
    const { stopId } = await params;
    const body = await request.json();
    const { name, description, duration_minutes, itineraryId } = body;

    if (!itineraryId) {
      return NextResponse.json(
        { error: "itineraryId is required" },
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
    let updated = false;

    for (const day of days) {
      const stops = day.stops as Record<string, unknown>[];
      if (!stops) continue;
      const stopIdx = stops.findIndex((s) => s.id === stopId);
      if (stopIdx >= 0) {
        stops[stopIdx] = {
          ...stops[stopIdx],
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(duration_minutes !== undefined && { duration_minutes }),
        };
        updated = true;
        break;
      }
    }

    if (!updated) {
      return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    }

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: days as object[] },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Stop PATCH Error]", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ stopId: string }> }
) {
  try {
    const { stopId } = await params;
    const body = await request.json();
    const { itineraryId } = body;

    if (!itineraryId) {
      return NextResponse.json(
        { error: "itineraryId is required" },
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
    let deleted = false;

    for (const day of days) {
      const stops = day.stops as Record<string, unknown>[];
      if (!stops) continue;
      const stopIdx = stops.findIndex((s) => s.id === stopId);
      if (stopIdx >= 0) {
        stops.splice(stopIdx, 1);
        deleted = true;
        break;
      }
    }

    if (!deleted) {
      return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    }

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: days as object[] },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Stop DELETE Error]", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

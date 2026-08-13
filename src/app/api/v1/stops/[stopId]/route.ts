import { NextResponse } from "next/server";
import { prisma, j } from "@/lib/db";
import { upsertPlace } from "@/lib/placeCache";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ stopId: string }> }
) {
  try {
    const { stopId } = await params;
    const body = await request.json();
    const { name, description, duration_minutes, estimated_cost, itineraryId } = body;
    // A full place swap (via the "換一個" picker) sends `placeId` alongside the
    // fields above — distinct from a plain text edit, which never includes it.
    const isPlaceSwap = "placeId" in body;
    const { placeId, lat, lng, address, rating, photoName } = body;

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
        if (day.isLocked === true) {
          return NextResponse.json(
            { error: "此天已鎖定為單一景點，無法編輯" },
            { status: 400 }
          );
        }
        const updatedStop: Record<string, unknown> = {
          ...stops[stopIdx],
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(duration_minutes !== undefined && { duration_minutes }),
        };
        // estimated_cost: null clears manually-entered cost data, a number sets it.
        if (estimated_cost !== undefined) {
          if (estimated_cost === null) {
            delete updatedStop.estimated_cost;
          } else {
            updatedStop.estimated_cost = estimated_cost;
          }
        }
        // A swapped-in place invalidates whatever suspicious/geo flags were
        // attached to the previous place at this slot.
        if (isPlaceSwap) {
          if (placeId) {
            updatedStop.placeId = placeId;
            updatedStop.lat = lat;
            updatedStop.lng = lng;
            updatedStop.address = address;
            updatedStop.rating = rating ?? null;
            updatedStop.photoName = photoName ?? null;
          } else {
            delete updatedStop.placeId;
            delete updatedStop.lat;
            delete updatedStop.lng;
            delete updatedStop.address;
            delete updatedStop.rating;
            delete updatedStop.photoName;
          }
          delete updatedStop.suspicious;
          delete updatedStop.suspiciousReason;
        }
        stops[stopIdx] = updatedStop;
        updated = true;
        break;
      }
    }

    if (!updated) {
      return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    }

    if (isPlaceSwap && placeId && typeof name === "string" && lat != null && lng != null) {
      await upsertPlace(name, { placeId, name, address: address ?? null, lat, lng, rating: rating ?? null, photoName: photoName ?? null });
    }

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    const updatedStop = (days as { stops?: Record<string, unknown>[] }[])
      .flatMap((d) => d.stops ?? [])
      .find((s) => s.id === stopId);

    return NextResponse.json({ success: true, stop: updatedStop });
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
    let deletedStop: Record<string, unknown> | null = null;
    let deletedFromDay: Record<string, unknown> | null = null;
    let deletedIndex = -1;

    for (const day of days) {
      const stops = day.stops as Record<string, unknown>[];
      if (!stops) continue;
      const stopIdx = stops.findIndex((s) => s.id === stopId);
      if (stopIdx >= 0) {
        if (day.isLocked === true) {
          return NextResponse.json(
            { error: "此天已鎖定為單一景點，無法刪除" },
            { status: 400 }
          );
        }
        [deletedStop] = stops.splice(stopIdx, 1);
        deletedFromDay = day;
        deletedIndex = stopIdx;
        break;
      }
    }

    if (!deletedStop || !deletedFromDay) {
      return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    }

    const [, createdDeletedStop] = await prisma.$transaction([
      prisma.itinerary.update({
        where: { id: itineraryId },
        data: { days: j(days) },
      }),
      prisma.deletedStop.create({
        data: {
          itineraryId,
          dayId: deletedFromDay.id as string,
          dayNumber: deletedFromDay.day as number,
          originalIndex: deletedIndex,
          stop: j(deletedStop),
        },
      }),
    ]);

    return NextResponse.json({ success: true, deletedStopId: createdDeletedStop.id });
  } catch (error) {
    console.error("[Stop DELETE Error]", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

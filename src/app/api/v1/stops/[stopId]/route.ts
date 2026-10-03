import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { upsertPlace } from "@/lib/placeCache";
import { findStopAcrossDays } from "@/lib/itineraryDays";
import { MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from "@/lib/inputLimits";
import { authorizeItinerary } from "@/lib/auth/ownership";

const id = z.string().min(1).max(MAX_NAME_LENGTH);

// Everything here is written straight into the itinerary JSON, and a place
// swap also goes into the shared Place cache (upsertPlace) — so types and
// ranges are checked rather than storing whatever the caller sent.
const PatchSchema = z.object({
  itineraryId: id,
  name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
  description: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
  // A cleared number input serializes as null (JSON has no NaN).
  duration_minutes: z.number().min(0).max(24 * 60).nullable().optional(),
  estimated_cost: z.number().min(0).max(1e9).nullable().optional(),
  placeId: id.nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  address: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  photoName: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
});

const DeleteSchema = z.object({ itineraryId: id });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ stopId: string }> }
) {
  try {
    const { stopId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { name, description, duration_minutes, estimated_cost, itineraryId } = parsed.data;
    // A full place swap (via the "換一個" picker) sends `placeId` alongside the
    // fields above — distinct from a plain text edit, which never includes it.
    const isPlaceSwap = "placeId" in body;
    const { placeId, lat, lng, address, rating, photoName } = parsed.data;

    const access = await authorizeItinerary(itineraryId);
    if (!access.ok) return access.response;
    const { itinerary } = access;

    const days = itinerary.days as Record<string, unknown>[];
    const location = findStopAcrossDays(days, stopId);

    if (!location) {
      return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    }

    // A locked day's single stop can still be edited in place (text fields,
    // or a full place swap) — only removing it entirely (which would leave
    // the day empty) stays blocked, in the DELETE handler below.
    const stops = location.day.stops as Record<string, unknown>[];
    const stopIdx = location.stopIndex;
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

    if (isPlaceSwap && placeId && typeof name === "string" && lat != null && lng != null) {
      await upsertPlace(name, { placeId, name, address: address ?? null, lat, lng, rating: rating ?? null, photoName: photoName ?? null });
    }

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

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
    const parsed = DeleteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { itineraryId } = parsed.data;

    const access = await authorizeItinerary(itineraryId);
    if (!access.ok) return access.response;
    const { itinerary } = access;

    const days = itinerary.days as Record<string, unknown>[];
    const location = findStopAcrossDays(days, stopId);

    if (!location) {
      return NextResponse.json({ error: "Stop not found" }, { status: 404 });
    }

    const stops = location.day.stops as Record<string, unknown>[];
    const [deletedStop] = stops.splice(location.stopIndex, 1);
    const deletedFromDay = location.day;
    const deletedIndex = location.stopIndex;

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

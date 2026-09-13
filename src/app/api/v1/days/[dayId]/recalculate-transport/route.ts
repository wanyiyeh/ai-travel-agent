import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import {
  describeTransport,
  getDistancesForStopPairs,
  pickModeForDistance,
} from "@/lib/distanceMatrix";
import { findDayIndex } from "@/lib/itineraryDays";
import { assignTimeOfDay } from "@/lib/scheduler/assignTimeSlots";

const RequestSchema = z.object({
  itineraryId: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ dayId: string }> }
) {
  try {
    const { dayId } = await params;
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { itineraryId } = parsed.data;

    const itinerary = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
    });

    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const dayIndex = findDayIndex(days, dayId);

    if (dayIndex === -1) {
      return NextResponse.json({ error: "Day not found" }, { status: 404 });
    }

    const day = days[dayIndex];
    const stops = day.stops as Record<string, unknown>[];
    const isFirstDay = dayIndex === 0;

    const prevAccommodationObj =
      dayIndex > 0
        ? (days[dayIndex - 1].accommodation as Record<string, unknown> | undefined)
        : undefined;

    const prevAccommodation = prevAccommodationObj
      ? prevAccommodationObj.name
        ? `${prevAccommodationObj.name}（${prevAccommodationObj.area}）`
        : `${prevAccommodationObj.area}`
      : null;

    const originDesc = isFirstDay
      ? "機場（去程航班抵達）"
      : prevAccommodation ?? "前一天住宿";

    // Prepend the previous night's accommodation (when it has coordinates) so the
    // real Google distance for the *first* stop of the day is grounded too —
    // otherwise the first stop's transport would have no data to go on.
    const originPoint =
      prevAccommodationObj &&
      typeof prevAccommodationObj.lat === "number" &&
      typeof prevAccommodationObj.lng === "number"
        ? { id: "__origin__", lat: prevAccommodationObj.lat as number, lng: prevAccommodationObj.lng as number }
        : null;

    const distancePoints = [
      ...(originPoint ? [originPoint] : []),
      ...stops.map((s) => ({
        id: s.id as string,
        lat: s.lat as number | null | undefined,
        lng: s.lng as number | null | undefined,
      })),
    ];

    const distanceResults = await getDistancesForStopPairs(distancePoints, pickModeForDistance);
    // When an origin point was prepended, distanceResults[0] is origin->stops[0],
    // so stop i's incoming leg is at distanceResults[i] instead of distanceResults[i-1].
    const distanceOffset = originPoint ? 0 : -1;

    const updatedFields = stops.map((s, i) => {
      const dist = i > 0 || originPoint ? distanceResults[i + distanceOffset] : null;
      const transport_from_prev = dist
        ? describeTransport(dist.mode, dist.durationSeconds)
        : i === 0
          ? `從${originDesc}出發`
          : "交通方式未知（缺少座標）";

      return {
        id: s.id as string,
        transport_from_prev,
        time_of_day: assignTimeOfDay(i, stops.length),
      };
    });

    const fieldMap = new Map(updatedFields.map((s) => [s.id, s]));

    days[dayIndex].stops = stops.map((stop) => {
      const updated = fieldMap.get(stop.id as string);
      if (!updated) return stop;
      return {
        ...stop,
        transport_from_prev: updated.transport_from_prev,
        time_of_day: updated.time_of_day,
      };
    });

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(days) },
    });

    return NextResponse.json({ stops: updatedFields });
  } catch (error) {
    console.error("[Recalculate Transport Error]", error);
    return NextResponse.json(
      { error: "Failed to recalculate", details: String(error) },
      { status: 500 }
    );
  }
}

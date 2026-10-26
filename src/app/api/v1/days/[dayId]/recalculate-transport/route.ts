import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import {
  describeTransport,
  getDistancesForStopPairs,
  modePickerFor,
} from "@/lib/distanceMatrix";
import { TripPreferencesSchema } from "@/lib/schemas";
import { findDayIndex } from "@/lib/itineraryDays";
import { assignTimeOfDay } from "@/lib/scheduler/assignTimeSlots";
import type { TimeOfDay } from "@/lib/dayTimeline";
import { transitStopIndex } from "@/lib/transitStop";
import { internalErrorResponse } from "@/lib/apiError";
import { authorizeItinerary } from "@/lib/auth/ownership";

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

    const access = await authorizeItinerary(itineraryId);
    if (!access.ok) return access.response;
    const { itinerary } = access;

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

    // The area only: the model writes this into transport_from_prev, which is
    // stored, and a hotel's Google name may not be (ADR-0004).
    const prevAccommodation =
      prevAccommodationObj && typeof prevAccommodationObj.area === "string" ? `${prevAccommodationObj.area}的住宿` : null;

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

    // Same leg rules as generation: the trip's indoor-first, self-drive and 長輩 choices.
    const preferences = TripPreferencesSchema.safeParse((itinerary.config as { preferences?: unknown }).preferences).data;
    const selfDrive = preferences?.transport === "drive";
    const seniors = preferences?.companions?.includes("seniors");
    const distanceResults = await getDistancesForStopPairs(
      distancePoints,
      modePickerFor({ indoorFirst: preferences?.indoorFirst, selfDrive, seniors })
    );
    // When an origin point was prepended, distanceResults[0] is origin->stops[0],
    // so stop i's incoming leg is at distanceResults[i] instead of distanceResults[i-1].
    const distanceOffset = originPoint ? 0 : -1;

    // A transit day's ride has no coordinates, so neither leg touching it is
    // looked up; it keeps the model's own ride time, and the first stop after
    // it starts from the arrival (ADR-0009).
    const transitIdx = transitStopIndex(stops, day);
    const arrivalDesc = typeof day.transitTo === "string" ? day.transitTo : "目的地";

    const updatedFields = stops.map((s, i) => {
      if (i === transitIdx) {
        return {
          id: s.id as string,
          transport_from_prev: s.transport_from_prev as string | undefined,
          time_of_day: (s.time_of_day as TimeOfDay | undefined) ?? assignTimeOfDay(i, stops.length),
        };
      }
      const dist = i > 0 || originPoint ? distanceResults[i + distanceOffset] : null;
      const transport_from_prev = dist
        ? describeTransport(dist.mode, dist.durationSeconds, dist.estimated, selfDrive)
        : i === 0
          ? `從${originDesc}出發`
          : transitIdx >= 0 && i === transitIdx + 1
            ? `抵達${arrivalDesc}後出發`
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
    return internalErrorResponse("Recalculate Transport Error", error, "Failed to recalculate");
  }
}

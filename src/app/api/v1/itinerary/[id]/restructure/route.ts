import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { iataToCity } from "@/lib/iataCity";
import {
  generateTransitDayStops,
  generateMealsAndAccommodation,
  generateDayStops,
} from "@/lib/itineraryCityGen";

const LockedAttractionSchema = z.object({
  name: z.string().min(1),
  placeId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  address: z.string().optional(),
  rating: z.number().nullable().optional(),
  photoName: z.string().nullable().optional(),
});

// One entry per city the user wants in the final trip, in final order.
// `targetDays` is the city's stay-day count (transit day, for a new city, is
// additional — same convention as WaypointCart's `stayDays`).
const CitySchema = z.object({
  name: z.string().min(1),
  isNew: z.boolean(),
  targetDays: z.number().int().min(1),
  keepDayIds: z.array(z.string()).default([]),
  lockedAttractions: z.array(LockedAttractionSchema).default([]),
});

const RequestSchema = z.object({
  cities: z.array(CitySchema).min(1),
});

type CityInput = z.infer<typeof CitySchema>;
type LockedAttraction = z.infer<typeof LockedAttractionSchema>;

function makeLockedStop(attraction: LockedAttraction): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    name: attraction.name,
    description: `整天鎖定景點：${attraction.name}`,
    duration_minutes: 480,
    time_of_day: "morning",
    placeId: attraction.placeId,
    lat: attraction.lat,
    lng: attraction.lng,
    address: attraction.address,
    rating: attraction.rating ?? null,
    photoName: attraction.photoName ?? null,
  };
}

function getFromCity(config: Record<string, unknown>): string {
  const fi = config.flightInfo as { arrivalCity?: string } | undefined;
  return iataToCity(fi?.arrivalCity ?? "");
}

// A "structural" day (inter-city transit day, or the trip's final return day)
// doesn't represent a day actually spent sightseeing in its assigned city, so
// it's excluded from a city's targetDays budget and always kept regardless of
// keepDayIds — the user can't accidentally shrink it away, and it stays
// pinned at the end of its city's block instead of being pushed around by
// newly-generated sightseeing days.
function isStructuralDay(day: Record<string, unknown>, lastOriginalDayId?: string): boolean {
  return day.isTransitDay === true || (lastOriginalDayId != null && day.id === lastOriginalDayId);
}

async function buildCityBlock(
  city: CityInput,
  idx: number,
  cities: CityInput[],
  daysById: Map<string, Record<string, unknown>>,
  config: Record<string, unknown>,
  currency: string,
  lastOriginalDayId: string | undefined
): Promise<Record<string, unknown>[]> {
  const lockedCount = city.lockedAttractions.length;

  if (!city.isNew) {
    const kept = city.keepDayIds
      .map((id) => daysById.get(id))
      .filter((d): d is Record<string, unknown> => d != null);
    const structuralKept = kept.filter((d) => isStructuralDay(d, lastOriginalDayId));
    const sightseeingKept = kept.filter((d) => !isStructuralDay(d, lastOriginalDayId));
    const reusableAccommodation = kept.map((d) => d.accommodation).find(Boolean);

    const extraCount = Math.max(0, city.targetDays - sightseeingKept.length - lockedCount);
    const extraStops = extraCount > 0 ? await generateDayStops(city.name, extraCount, currency) : [];
    const extraDays = extraStops.map((stops) => ({
      id: crypto.randomUUID(),
      day: 0,
      theme: `${city.name} 探索`,
      waypointCity: city.name,
      stops,
      accommodation: reusableAccommodation,
    }));

    const lockedDays = city.lockedAttractions.map((attraction) => ({
      id: crypto.randomUUID(),
      day: 0,
      theme: attraction.name,
      isLocked: true,
      stops: [makeLockedStop(attraction)],
      accommodation: reusableAccommodation,
    }));

    // Transit-out/return days are pinned after the sightseeing content so a
    // newly-added day never gets stranded on the far side of a move.
    return [...sightseeingKept, ...extraDays, ...lockedDays, ...structuralKept];
  }

  // New city: leading transit day + AI sightseeing days + locked days.
  // fromCity chains off the previous city block in the final arrangement,
  // falling back to the trip's arrival city for the very first block.
  const fromCityName = idx === 0 ? getFromCity(config) : cities[idx - 1].name;
  const aiDayCount = Math.max(0, city.targetDays - lockedCount);

  const [transitStops, sightseeingStops, mealsAndAccommodation] = await Promise.all([
    generateTransitDayStops(fromCityName, city.name, currency).catch(() => []),
    aiDayCount > 0
      ? generateDayStops(city.name, aiDayCount, currency).catch(() =>
          Array.from({ length: aiDayCount }, () => [])
        )
      : Promise.resolve([]),
    generateMealsAndAccommodation(city.name, city.targetDays, currency).catch(() => ({
      accommodation: {},
      mealsByDay: Array.from({ length: city.targetDays }, () => ({})),
    })),
  ]);

  const hasAccommodation = Object.keys(mealsAndAccommodation.accommodation).length > 0;
  const accommodation = hasAccommodation ? mealsAndAccommodation.accommodation : undefined;

  const transitDay = {
    id: crypto.randomUUID(),
    day: 0,
    theme: `移動日：前往${city.name}`,
    isTransitDay: true,
    transitTo: city.name,
    stops: transitStops,
  };

  const sightseeingDays = sightseeingStops.map((stops, i) => ({
    id: crypto.randomUUID(),
    day: 0,
    theme: `${city.name} 探索`,
    waypointCity: city.name,
    stops,
    accommodation,
    meals: mealsAndAccommodation.mealsByDay[i] ?? {},
  }));

  const lockedDays = city.lockedAttractions.map((attraction, i) => ({
    id: crypto.randomUUID(),
    day: 0,
    theme: attraction.name,
    isLocked: true,
    waypointCity: city.name,
    stops: [makeLockedStop(attraction)],
    accommodation,
    meals: mealsAndAccommodation.mealsByDay[aiDayCount + i] ?? {},
  }));

  return [transitDay, ...sightseeingDays, ...lockedDays];
}

// Rebuilds the entire itinerary from a user-declared list of cities (each
// either kept-and-resized or newly added), each with optional full-day
// locked attractions. Runs as a single read-modify-write so the result is
// applied atomically — see the "no shared save/recalculate function" note in
// the plan for why every other day-mutating route in this codebase instead
// serializes its calls client-side.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: itineraryId } = await params;
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { cities } = parsed.data;

    const itinerary = await prisma.itinerary.findUnique({ where: { id: itineraryId } });
    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const config = (itinerary.config ?? {}) as Record<string, unknown>;
    const currency = (config.currency as string) ?? "EUR";

    const daysById = new Map(days.map((d) => [d.id as string, d]));
    const keptIds = new Set(cities.flatMap((c) => c.keepDayIds));
    const discardedDays = days.filter((d) => !keptIds.has(d.id as string));
    const lastOriginalDayId = days.length > 0 ? (days[days.length - 1].id as string) : undefined;

    const blocks = await Promise.all(
      cities.map((city, idx) =>
        buildCityBlock(city, idx, cities, daysById, config, currency, lastOriginalDayId)
      )
    );
    const finalDays = blocks.flat().map((d, i) => ({ ...d, day: i + 1 }));

    const deletedDayRows = discardedDays.map((d) => ({
      itineraryId,
      originalIndex: days.findIndex((dd) => dd.id === d.id),
      day: j(d),
    }));

    await prisma.$transaction([
      prisma.itinerary.update({ where: { id: itineraryId }, data: { days: j(finalDays) } }),
      ...(deletedDayRows.length > 0 ? [prisma.deletedDay.createMany({ data: deletedDayRows })] : []),
    ]);

    return NextResponse.json({
      success: true,
      removedDayCount: discardedDays.length,
      addedDayCount: finalDays.length - keptIds.size,
    });
  } catch (error) {
    console.error("[Restructure Itinerary Error]", error);
    return NextResponse.json(
      { error: "Failed to restructure itinerary", details: String(error) },
      { status: 500 }
    );
  }
}

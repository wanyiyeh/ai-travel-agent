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
// `targetDays` is the city's total day count — for a new city this includes
// its leading transit day; for an existing city it includes its structural
// (transit/return) days.
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
// doesn't represent a day actually spent sightseeing in its assigned city —
// it's counted toward a city's targetDays total but not its sightseeing
// budget, and it's always kept regardless of keepDayIds — the user can't
// accidentally shrink it away, and it stays pinned at the end of its city's
// block instead of being pushed around by newly-generated sightseeing days.
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
    let structuralKept = kept.filter((d) => isStructuralDay(d, lastOriginalDayId));
    let sightseeingKept = kept.filter((d) => !isStructuralDay(d, lastOriginalDayId));
    const reusableAccommodation = kept.map((d) => d.accommodation).find(Boolean);

    // A transit day is tagged with its departure city (see the "new city"
    // branch below), so an existing city's own structural day is its
    // *outbound* leg to whichever city originally followed it, not an
    // inbound one. A bucket can end up holding more than one such day after
    // a prior restructure inserted a city right after this one — the new
    // city's freshly-generated leading transit day is tagged with *this*
    // city's name (its departure city) and gets swept back into this bucket
    // on the next regroup, even though it's not this city's own departure.
    // Only the last one in original day order is this city's real, currently
    // active outbound leg; earlier ones are vestiges of an older insertion
    // and are dropped rather than replayed as bogus extra transit days —
    // `extraCount` below picks up the resulting slot with a fresh AI day.
    let lastTransitIdx = -1;
    for (let i = structuralKept.length - 1; i >= 0; i--) {
      if (structuralKept[i].isTransitDay === true) {
        lastTransitIdx = i;
        break;
      }
    }
    structuralKept = structuralKept.filter(
      (d, i) => d.isTransitDay !== true || i === lastTransitIdx
    );
    const outboundIdx = structuralKept.findIndex((d) => d.isTransitDay === true);

    const nextCity = idx < cities.length - 1 ? cities[idx + 1] : undefined;
    if (outboundIdx !== -1 && nextCity?.isNew) {
      // The next city is new, and a new city always generates its own fresh
      // leading transit day from whatever precedes it (see below) — keeping
      // this city's own outbound day too would describe the same leg twice.
      structuralKept = structuralKept.filter((_, i) => i !== outboundIdx);
    } else if (outboundIdx !== -1 && nextCity && structuralKept[outboundIdx].transitTo !== nextCity.name) {
      // Existing cities can't be reordered relative to each other, so this
      // is mostly a safety net — but if a new city that used to sit here got
      // removed again in this same session, this day still points at the
      // old next city and needs its stops/transitTo refreshed.
      const stops = await generateTransitDayStops(city.name, nextCity.name, currency).catch(() => []);
      structuralKept = structuralKept.map((d, i) =>
        i === outboundIdx
          ? { ...d, stops, transitTo: nextCity.name, theme: `移動日：前往${nextCity.name}` }
          : d
      );
    }

    // Existing cities never store a day describing *arrival* into them (only
    // their own outbound leg, if any — see above). That's fine as long as
    // whoever precedes them is unchanged, but if a new city got dragged in
    // right before this one, nothing else generates that connecting leg — a
    // new city's own block (below) only generates its own *leading* (i.e.
    // incoming) day, never a trailing one, so the leg into this city still
    // needs to be built here.
    const prevCity = idx > 0 ? cities[idx - 1] : undefined;
    let leadingInDay: Record<string, unknown> | null = null;
    if (prevCity?.isNew) {
      const stops = await generateTransitDayStops(prevCity.name, city.name, currency).catch(() => []);
      leadingInDay = {
        id: crypto.randomUUID(),
        day: 0,
        theme: `移動日：前往${city.name}`,
        isTransitDay: true,
        transitTo: city.name,
        waypointCity: prevCity.name,
        stops,
      };
    }

    const structuralUsed = structuralKept.length + (leadingInDay ? 1 : 0);
    // The client is expected to keep keepDayIds within targetDays, but if it
    // sends a stale selection (e.g. days were checked before targetDays was
    // last lowered) that leaves more kept sightseeing days than the city's
    // budget allows, silently keeping all of them would make this city — and
    // the whole trip — longer than targetDays with no extraCount left to
    // absorb the overage. Drop the excess (earliest-first, mirroring the
    // client's own default-keep truncation) rather than exceed the budget.
    const sightseeingCap = Math.max(0, city.targetDays - structuralUsed - lockedCount);
    if (sightseeingKept.length > sightseeingCap) {
      sightseeingKept = sightseeingKept.slice(0, sightseeingCap);
    }
    const extraCount = Math.max(
      0,
      city.targetDays - structuralUsed - sightseeingKept.length - lockedCount
    );
    // Both the AI-filled days and the locked-attraction days are brand new
    // nights in this city, so they share one accommodation/meals call — a
    // kept day's accommodation (if any) still wins, to avoid switching
    // hotels mid-stay for no reason.
    const newDaysNeeded = extraCount + lockedCount;
    const [extraStops, mealsAndAccommodation] = await Promise.all([
      extraCount > 0
        ? generateDayStops(city.name, extraCount, currency).catch(() =>
            Array.from({ length: extraCount }, () => [])
          )
        : Promise.resolve([]),
      newDaysNeeded > 0
        ? generateMealsAndAccommodation(city.name, newDaysNeeded, currency).catch(() => ({
            accommodation: {},
            mealsByDay: Array.from({ length: newDaysNeeded }, () => ({})),
          }))
        : Promise.resolve({ accommodation: {}, mealsByDay: [] as Record<string, unknown>[] }),
    ]);
    const hasGeneratedAccommodation = Object.keys(mealsAndAccommodation.accommodation).length > 0;
    const accommodation = reusableAccommodation ?? (hasGeneratedAccommodation ? mealsAndAccommodation.accommodation : undefined);

    const extraDays = extraStops.map((stops, i) => ({
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
      meals: mealsAndAccommodation.mealsByDay[extraCount + i] ?? {},
    }));

    // A leading-in day (if generated above) goes first; transit-out/return
    // days are pinned after the sightseeing content so a newly-added day
    // never gets stranded on the far side of a move.
    return [
      ...(leadingInDay ? [leadingInDay] : []),
      ...sightseeingKept,
      ...extraDays,
      ...lockedDays,
      ...structuralKept,
    ];
  }

  // New city: leading transit day + AI sightseeing days + locked days.
  // fromCity chains off the previous city block in the final arrangement,
  // falling back to the trip's arrival city for the very first block.
  const fromCityName = idx === 0 ? getFromCity(config) : cities[idx - 1].name;
  // targetDays includes the leading transit day, so only targetDays - 1 days
  // are available for AI sightseeing + locked attractions.
  const aiDayCount = Math.max(0, city.targetDays - 1 - lockedCount);
  const nights = Math.max(1, city.targetDays - 1);

  const [transitStops, sightseeingStops, mealsAndAccommodation] = await Promise.all([
    generateTransitDayStops(fromCityName, city.name, currency).catch(() => []),
    aiDayCount > 0
      ? generateDayStops(city.name, aiDayCount, currency).catch(() =>
          Array.from({ length: aiDayCount }, () => [])
        )
      : Promise.resolve([]),
    generateMealsAndAccommodation(city.name, nights, currency).catch(() => ({
      accommodation: {},
      mealsByDay: Array.from({ length: nights }, () => ({})),
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
    // Tag with the departure city, matching tagWaypointCities' convention —
    // otherwise this day has no waypointCity at all and RestructurePanel
    // groups it into an unnamed bucket next time the panel is opened.
    waypointCity: fromCityName,
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
    const rawFinalDays = blocks.flat();

    // The trip's original last day (the "回程日" flight-home day, or whatever
    // day used to close out the itinerary) is pinned to the *end of its own
    // city's block* by isStructuralDay/buildCityBlock — correct as long as
    // that city is still the last one in the trip. If this restructure added
    // or reordered a city after it, that day now sits stranded mid-trip
    // instead of closing out the actual new last city. It represents leaving
    // the trip, not that specific city, so re-home it to trail whichever city
    // ends up last and relabel it accordingly. A day that's itself a transit
    // day is left alone — a transit leg can't legitimately be the trip's
    // final day, so this only ever fires on a plain closing day.
    const newLastCity = cities[cities.length - 1];
    if (lastOriginalDayId && newLastCity) {
      const idx = rawFinalDays.findIndex((d) => d.id === lastOriginalDayId);
      if (
        idx !== -1 &&
        idx !== rawFinalDays.length - 1 &&
        rawFinalDays[idx].isTransitDay !== true
      ) {
        const [returnDay] = rawFinalDays.splice(idx, 1);
        rawFinalDays.push({ ...returnDay, waypointCity: newLastCity.name });
      }
    }

    const finalDays = rawFinalDays.map((d, i) => ({ ...d, day: i + 1 }));

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

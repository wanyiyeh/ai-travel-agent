import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, j } from "@/lib/db";
import { TransitRecommendationSchema } from "@/lib/schemas";
import { openai } from "@/lib/openai";
import { iataToCity } from "@/lib/iataCity";
import {
  generateTransitDayStops,
  generateMealsAndAccommodation,
  generateDayStops,
} from "@/lib/itineraryCityGen";

const ItemSchema = z.object({
  recommendation: TransitRecommendationSchema,
  stayDays: z.number().int().min(1).max(14),
});

const RequestSchema = z.object({
  items: z.array(ItemSchema).min(1).max(8),
  maxDays: z.number().int().min(1).optional(),
  insertAfterDay: z.number().int().min(1).optional(),
});


async function findOptimalInsertionIndex(
  days: Record<string, unknown>[],
  cityNames: string[]
): Promise<{ insertAfterIndex: number; reason: string }> {
  if (days.length <= 1) return { insertAfterIndex: 0, reason: "" };

  const daySummaries = days.map((d, i) => ({
    dayNumber: i + 1,
    theme: d.theme,
    stopCount: Array.isArray(d.stops) ? d.stops.length : 0,
  }));

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a travel planning assistant. Suggest the best day to insert new transit destinations. Respond with valid JSON only.",
        },
        {
          role: "user",
          content: `Current itinerary days: ${JSON.stringify(daySummaries)}
Destinations to insert in order: ${cityNames.join(" → ")}

Choose insertAfterDay between 1 and ${days.length - 1}.
Prefer days with fewer stops (easier transition), avoid splitting the first or last day.

Respond with JSON: { "insertAfterDay": <number>, "reason": "<一句話繁體中文說明>" }`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 150,
    });

    const parsed = JSON.parse(response.choices[0].message.content ?? "{}") as {
      insertAfterDay?: number;
      reason?: string;
    };
    const insertAfterDay = Math.max(
      1,
      Math.min(parsed.insertAfterDay ?? Math.floor(days.length / 2), days.length - 1)
    );
    return { insertAfterIndex: insertAfterDay, reason: parsed.reason ?? "" };
  } catch {
    return { insertAfterIndex: Math.floor(days.length / 2), reason: "" };
  }
}

function getFromCity(
  beforeDays: Record<string, unknown>[],
  config: Record<string, unknown>
): string {
  for (let i = beforeDays.length - 1; i >= 0; i--) {
    const t = beforeDays[i].transitTo;
    if (t && typeof t === "string") return t;
    const wc = beforeDays[i].waypointCity;
    if (wc && typeof wc === "string") return wc;
  }
  const fi = config.flightInfo as { arrivalCity?: string } | undefined;
  return iataToCity(fi?.arrivalCity ?? "");
}

function getNextCity(
  afterDays: Record<string, unknown>[],
  config: Record<string, unknown>
): string | null {
  for (const day of afterDays) {
    if (day.waypointCity && typeof day.waypointCity === "string") return day.waypointCity;
  }
  const fi = config.flightInfo as { returnDepartureCity?: string } | undefined;
  const code = fi?.returnDepartureCity;
  return code ? iataToCity(code) : null;
}

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

    const { items, maxDays, insertAfterDay: userInsertAfterDay } = parsed.data;

    const itinerary = await prisma.itinerary.findUnique({
      where: { id: itineraryId },
    });

    if (!itinerary) {
      return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
    }

    const days = itinerary.days as Record<string, unknown>[];
    const config = (itinerary.config ?? {}) as Record<string, unknown>;
    const currency = (config.currency as string) ?? "EUR";

    let insertAfterIndex: number;
    let reason: string;
    if (userInsertAfterDay != null) {
      insertAfterIndex = Math.max(0, Math.min(userInsertAfterDay, days.length - 1));
      reason = "";
    } else {
      const cityNames = items.map((i) => i.recommendation.name);
      ({ insertAfterIndex, reason } = await findOptimalInsertionIndex(days, cityNames));
    }

    // Never insert immediately after a transit day — shift back so the transit day
    // lands in `after` where the update logic can reach it.
    while (insertAfterIndex > 0 && days[insertAfterIndex - 1]?.isTransitDay === true) {
      insertAfterIndex--;
    }

    const before = days.slice(0, insertAfterIndex);
    // Snapshot the unmodified after-block before any trimming or content changes.
    // remove-waypoint uses this to fully restore the original days.
    const originalAfter = days.slice(insertAfterIndex);
    const after = originalAfter;

    // Find the first transit day in `after` to update its departure city,
    // and determine if we need a new return transit day when none exists.
    const lastInsertedCity = items[items.length - 1].recommendation.name;
    const nextTransitDayIndex = after.findIndex((d) => d.isTransitDay === true);
    const nextTransitDay = nextTransitDayIndex >= 0 ? after[nextTransitDayIndex] : null;
    const needsReturnTransit = !nextTransitDay && after.length > 0;
    const returnCity = needsReturnTransit ? getNextCity(after, config) : null;

    // Compute fromCity chain: first item leaves from existing itinerary's last city,
    // each subsequent item leaves from the previous item's destination
    const initialFromCity = getFromCity(before, config);
    const fromCities = items.map((item, idx) =>
      idx === 0 ? initialFromCity : items[idx - 1].recommendation.name
    );

    // Generate all content in parallel: per-city transit/stay/meals, the updated
    // next-transit-day stops (if one exists), and the new return transit (if needed).
    const [allTransitStops, allGeneratedStops, allMealsAndAccommodation, updatedNextTransitStops, returnTransitStops] = await Promise.all([
      Promise.all(
        items.map((item, idx) =>
          generateTransitDayStops(fromCities[idx], item.recommendation.name, currency).catch(
            () => []
          )
        )
      ),
      Promise.all(
        items.map((item) =>
          generateDayStops(item.recommendation.name, item.stayDays, currency).catch(() =>
            Array.from({ length: item.stayDays }, () => [])
          )
        )
      ),
      Promise.all(
        items.map((item) =>
          generateMealsAndAccommodation(item.recommendation.name, item.stayDays, currency).catch(() => ({
            accommodation: {},
            mealsByDay: Array.from({ length: item.stayDays }, () => ({})),
          }))
        )
      ),
      nextTransitDay
        ? generateTransitDayStops(lastInsertedCity, nextTransitDay.transitTo as string, currency).catch(() => null)
        : Promise.resolve(null),
      returnCity
        ? generateTransitDayStops(lastInsertedCity, returnCity, currency).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Build the block to insert: [transitDay + stayDays] per city, in order
    const insertedBlock: Record<string, unknown>[] = [];
    items.forEach((item, idx) => {
      const { accommodation, mealsByDay } = allMealsAndAccommodation[idx];
      const hasAccommodation = Object.keys(accommodation).length > 0;

      insertedBlock.push({
        id: crypto.randomUUID(),
        day: 0,
        theme: `移動日：前往${item.recommendation.name}`,
        isTransitDay: true,
        transitTo: item.recommendation.name,
        stops: allTransitStops[idx],
        // Stash the full original after-block in the first transit day only.
        // remove-waypoint reads this to restore days that were trimmed by maxDays.
        _originalAfter: idx === 0 ? originalAfter : null,
      });
      allGeneratedStops[idx].forEach((stops, dayIdx) => {
        insertedBlock.push({
          id: crypto.randomUUID(),
          day: 0,
          theme: `${item.recommendation.name} 探索`,
          waypointCity: item.recommendation.name,
          stops,
          accommodation: hasAccommodation ? accommodation : undefined,
          meals: mealsByDay[dayIdx] ?? {},
        });
      });
    });
    const updatedAfter =
      nextTransitDay && updatedNextTransitStops && nextTransitDayIndex >= 0
        ? after.map((d, i) =>
            i === nextTransitDayIndex
              ? { ...d, stops: updatedNextTransitStops, theme: `移動日：前往${nextTransitDay.transitTo as string}` }
              : d
          )
        : after;

    const returnTransitDay: Record<string, unknown> | null =
      returnTransitStops && returnCity
        ? {
            id: crypto.randomUUID(),
            day: 0,
            theme: `移動日：前往${returnCity}`,
            isTransitDay: true,
            transitTo: returnCity,
            stops: returnTransitStops,
          }
        : null;

    // Enforce maxDays: trim excess days from after, removing non-transit days first
    // and always preserving the last day (final destination / return day).
    let finalAfter = updatedAfter;
    if (maxDays != null) {
      const returnTransitCount = returnTransitDay ? 1 : 0;
      const overflow = before.length + insertedBlock.length + returnTransitCount + updatedAfter.length - maxDays;
      if (overflow > 0) {
        const candidates = updatedAfter
          .map((d, i) => ({ i, isTransit: d.isTransitDay === true, isLocked: d.isLocked === true }))
          .filter(({ i, isLocked }) => i < updatedAfter.length - 1 && !isLocked) // never remove last day or a locked day
          .sort((a, b) => Number(a.isTransit) - Number(b.isTransit)); // non-transit first
        const removeSet = new Set(candidates.slice(0, overflow).map((c) => c.i));
        finalAfter = updatedAfter.filter((_, i) => !removeSet.has(i));
      }
    }

    let finalInsertedBlock = insertedBlock;
    let stillOverflow =
      maxDays != null
        ? before.length + insertedBlock.length + (returnTransitDay ? 1 : 0) + finalAfter.length - maxDays
        : 0;
    if (stillOverflow > 0) {
      // updatedAfter ran out of removable candidates. Keep trimming, but only from the
      // newly inserted city's extra sightseeing days (never the transit-day headers,
      // `returnTransitDay`, or `finalAfter`'s protected last/return day) — those must
      // never be dropped, even if that means the trip ends up longer than `maxDays`.
      finalInsertedBlock = [...insertedBlock];
      for (let i = finalInsertedBlock.length - 1; i >= 0 && stillOverflow > 0; i--) {
        if (finalInsertedBlock[i].isTransitDay !== true) {
          finalInsertedBlock.splice(i, 1);
          stillOverflow--;
        }
      }
    }

    const cappedDays = [...before, ...finalInsertedBlock, ...(returnTransitDay ? [returnTransitDay] : []), ...finalAfter];
    const updatedDays = cappedDays.map((d, i) => ({
      ...d,
      day: i + 1,
    }));

    await prisma.itinerary.update({
      where: { id: itineraryId },
      data: { days: j(updatedDays) },
    });

    return NextResponse.json({ success: true, insertionReason: reason });
  } catch (error) {
    console.error("[Batch Insert Waypoints Error]", error);
    return NextResponse.json(
      { error: "Failed to batch insert waypoints", details: String(error) },
      { status: 500 }
    );
  }
}

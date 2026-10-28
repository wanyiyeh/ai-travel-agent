import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { authorizeItinerary, authorizeItineraryRead } from "@/lib/auth/ownership";
import { currencyOf } from "@/lib/airportIndex";

function inferCurrency(flightInfo: unknown): string | undefined {
  if (!flightInfo || typeof flightInfo !== "object") return undefined;
  const fi = flightInfo as Record<string, unknown>;
  const iata = (fi.arrivalCity ?? fi.returnDepartureCity) as string | undefined;
  return iata ? currencyOf(iata) : undefined;
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await authorizeItinerary(id);
    if (!access.ok) return access.response;
    await prisma.itinerary.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Itinerary DELETE Error]", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

// `?days=1,3`: fetch place names (ADR-0004) for those days only; the page
// asks for the days it shows. Without it, every day — until the page opens
// with only the first day expanded (#202).
function daysToHydrate(request: Request): number[] | "all" {
  const param = new URL(request.url).searchParams.get("days");
  if (!param) return "all";
  const days = param.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return days.length > 0 ? days : "all";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Owners, or anyone for an admin-published example (read-only).
    const access = await authorizeItineraryRead(id, daysToHydrate(request));
    if (!access.ok) return access.response;
    const { itinerary } = access;
    const isOwner = access.access === "owner";

    const rawConfig = (itinerary.config && typeof itinerary.config === "object"
      ? itinerary.config
      : {}) as Record<string, unknown>;
    // The style blurb is whatever the owner typed when generating; it's not
    // part of the trip itself, so a public viewer doesn't get it.
    const config = isOwner
      ? rawConfig
      : Object.fromEntries(Object.entries(rawConfig).filter(([key]) => key !== "generatedWith"));
    return NextResponse.json({
      success: true,
      id: itinerary.id,
      data: {
        title: itinerary.title,
        currency: (config.currency as string | null | undefined) ?? inferCurrency(config.flightInfo) ?? undefined,
        days: itinerary.days,
      },
      config,
      createdAt: itinerary.createdAt,
      // Set only for guest itineraries; the page shows a "sign in to keep it"
      // notice. Hours left is computed here so the client render stays pure.
      expiresAt: itinerary.expiresAt,
      expiresInHours: itinerary.expiresAt
        ? Math.max(0, Math.ceil((itinerary.expiresAt.getTime() - Date.now()) / (60 * 60 * 1000)))
        : null,
      // "public" → the page renders read-only (no edit controls, no
      // auto-enrich); the write routes would refuse a non-owner anyway.
      access: access.access,
      isPublic: itinerary.isPublic,
      canPublish: isOwner && Boolean(access.actor?.isAdmin),
    });
  } catch (error) {
    console.error("[Itinerary GET Error]", error);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

const PatchSchema = z.object({ isPublic: z.boolean() });

// Publishing an itinerary as a read-only example is admin-only, and only for
// the admin's own itineraries (plan/access-control.md §8).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const access = await authorizeItinerary(id);
    if (!access.ok) return access.response;
    if (!access.actor.isAdmin) {
      return NextResponse.json({ error: "只有管理者可以公開行程" }, { status: 403 });
    }

    const updated = await prisma.itinerary.update({
      where: { id },
      data: { isPublic: parsed.data.isPublic },
      select: { isPublic: true },
    });
    return NextResponse.json({ success: true, isPublic: updated.isPublic });
  } catch (error) {
    console.error("[Itinerary PATCH Error]", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

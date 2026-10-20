import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActor, type Actor } from "@/lib/auth/actor";
import { hydrateDays, type DaysToHydrate } from "@/lib/placeDisplay";
import { runMetered } from "@/lib/usageMeter";

// Every route that reads or writes an itinerary (or its trash / candidate
// logs) goes through authorizeItinerary() before touching it — the route
// itself, not just proxy.ts, since Next.js has had middleware-bypass bugs.
// plan/access-control.md §6.
//
// Not found, not yours, and (later) expired all answer 404 the same way, so a
// caller can't probe which itinerary ids exist.

export function signInRequired() {
  return NextResponse.json({ error: "Sign in required" }, { status: 401 });
}

export function itineraryNotFound() {
  return NextResponse.json({ error: "Itinerary not found" }, { status: 404 });
}

export async function findOwnedItinerary(actor: Actor, itineraryId: string) {
  return prisma.itinerary.findFirst({
    where: {
      id: itineraryId,
      userId: actor.userId,
      // An expired guest itinerary reads as gone even before cleanup deletes it.
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
}

// Same shape the extended client in db.ts returns (days/config already parsed).
export type OwnedItinerary = NonNullable<Awaited<ReturnType<typeof findOwnedItinerary>>>;

type Authorized = { ok: true; actor: Actor; itinerary: OwnedItinerary };
type Denied = { ok: false; response: NextResponse };

// Storage keeps only place IDs (ADR-0004), so a route that shows or uses
// place names asks for the days it needs: their names and addresses are
// fetched back from Google here, after the ownership check, and metered.
async function withPlaceDisplays(itinerary: OwnedItinerary, hydrate: DaysToHydrate | undefined) {
  if (hydrate && Array.isArray(itinerary.days)) {
    await runMetered("hydrate", () => hydrateDays(itinerary.days as unknown[], hydrate));
  }
  return itinerary;
}

// Resolves the caller and loads the itinerary only if they own it.
// `hydrate`: the days whose place names the route needs (see withPlaceDisplays).
export async function authorizeItinerary(
  itineraryId: string | null | undefined,
  hydrate?: DaysToHydrate,
): Promise<Authorized | Denied> {
  const actor = await getActor();
  if (!actor) return { ok: false, response: signInRequired() };
  if (!itineraryId) return { ok: false, response: itineraryNotFound() };
  const itinerary = await findOwnedItinerary(actor, itineraryId);
  if (!itinerary) return { ok: false, response: itineraryNotFound() };
  return { ok: true, actor, itinerary: await withPlaceDisplays(itinerary, hydrate) };
}

type ReadAuthorized = {
  ok: true;
  // "public": a non-owner viewing an admin-published example — read-only.
  access: "owner" | "public";
  actor: Actor | null;
  itinerary: OwnedItinerary;
};

// For read-only endpoints only (GET itinerary). Owners get full access; anyone
// else — signed in or not — may read an itinerary marked public. Every write
// route keeps using authorizeItinerary(), so a public itinerary is never
// writable by a non-owner. plan/access-control.md §8.
export async function authorizeItineraryRead(
  itineraryId: string | null | undefined,
  hydrate?: DaysToHydrate,
): Promise<ReadAuthorized | Denied> {
  const actor = await getActor();
  if (!itineraryId) return { ok: false, response: itineraryNotFound() };
  if (actor) {
    const owned = await findOwnedItinerary(actor, itineraryId);
    if (owned) return { ok: true, access: "owner", actor, itinerary: await withPlaceDisplays(owned, hydrate) };
  }
  const shared = await prisma.itinerary.findFirst({
    where: { id: itineraryId, isPublic: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  });
  if (shared) return { ok: true, access: "public", actor, itinerary: await withPlaceDisplays(shared, hydrate) };
  // Same answers as before public itineraries existed.
  return { ok: false, response: actor ? itineraryNotFound() : signInRequired() };
}

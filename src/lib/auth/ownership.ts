import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActor, type Actor } from "@/lib/auth/actor";

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
  return prisma.itinerary.findFirst({ where: { id: itineraryId, userId: actor.userId } });
}

// Same shape the extended client in db.ts returns (days/config already parsed).
export type OwnedItinerary = NonNullable<Awaited<ReturnType<typeof findOwnedItinerary>>>;

type Authorized = { ok: true; actor: Actor; itinerary: OwnedItinerary };
type Denied = { ok: false; response: NextResponse };

// Resolves the caller and loads the itinerary only if they own it.
export async function authorizeItinerary(itineraryId: string | null | undefined): Promise<Authorized | Denied> {
  const actor = await getActor();
  if (!actor) return { ok: false, response: signInRequired() };
  if (!itineraryId) return { ok: false, response: itineraryNotFound() };
  const itinerary = await findOwnedItinerary(actor, itineraryId);
  if (!itinerary) return { ok: false, response: itineraryNotFound() };
  return { ok: true, actor, itinerary };
}

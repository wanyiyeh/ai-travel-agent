import { prisma } from "@/lib/db";
import { COORDS_MAX_AGE_MS } from "@/lib/placeStorage";

/**
 * Query string → place ID, and a place's coordinates — the only Google
 * content the terms let us keep (ADR-0004): a place ID indefinitely, its
 * latitude/longitude for up to 30 days. Names, addresses, ratings, types and
 * photos are fetched when they're needed and never written here.
 */

// Older coordinates read as missing here; coordsPurge.ts deletes them.
export { COORDS_MAX_AGE_MS };

export interface CachedPlace {
  placeId: string;
  /** null when never fetched, or fetched more than COORDS_MAX_AGE_MS ago. */
  lat: number | null;
  lng: number | null;
}

type PlaceRow = { id: string; lat: number | null; lng: number | null; coordsFetchedAt: Date | null };

function fromRow(row: PlaceRow): CachedPlace {
  const fresh = row.coordsFetchedAt != null && Date.now() - row.coordsFetchedAt.getTime() < COORDS_MAX_AGE_MS;
  return fresh && row.lat != null && row.lng != null
    ? { placeId: row.id, lat: row.lat, lng: row.lng }
    : { placeId: row.id, lat: null, lng: null };
}

const PLACE_SELECT = { id: true, lat: true, lng: true, coordsFetchedAt: true } as const;

export async function lookupByQuery(query: string): Promise<CachedPlace | null> {
  const hit = await prisma.placeQuery.findUnique({ where: { query }, include: { place: { select: PLACE_SELECT } } });
  return hit ? fromRow(hit.place) : null;
}

export async function lookupByPlaceId(placeId: string): Promise<CachedPlace | null> {
  const row = await prisma.place.findUnique({ where: { id: placeId }, select: PLACE_SELECT });
  return row ? fromRow(row) : null;
}

/** Remembers which place a query found, and that place's coordinates as of now. */
export async function upsertPlace(query: string, place: { placeId: string; lat: number; lng: number }): Promise<void> {
  const coords = { lat: place.lat, lng: place.lng, coordsFetchedAt: new Date() };
  await prisma.place.upsert({
    where: { id: place.placeId },
    create: { id: place.placeId, ...coords },
    update: coords,
  });
  await prisma.placeQuery.upsert({
    where: { query },
    create: { query, placeId: place.placeId },
    update: { placeId: place.placeId },
  });
}

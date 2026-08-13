import { prisma } from "@/lib/db";

export interface CachedPlace {
  placeId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  types: string[] | null;
  photoName: string | null;
}

function parseTypes(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function lookupByQuery(query: string): Promise<CachedPlace | null> {
  const hit = await prisma.placeQuery.findUnique({
    where: { query },
    include: { place: true },
  });
  if (!hit) return null;
  const p = hit.place;
  return { placeId: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng, rating: p.rating, types: parseTypes(p.types), photoName: p.photoName };
}

export async function lookupByPlaceId(placeId: string): Promise<CachedPlace | null> {
  const p = await prisma.place.findUnique({ where: { id: placeId } });
  if (!p) return null;
  return { placeId: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng, rating: p.rating, types: parseTypes(p.types), photoName: p.photoName };
}

export async function upsertPlace(
  query: string,
  data: { placeId: string; name: string; address: string | null; lat: number; lng: number; rating?: number | null; types?: string[] | null; photoName?: string | null }
): Promise<void> {
  const types = data.types ? JSON.stringify(data.types) : undefined;

  await prisma.place.upsert({
    where: { id: data.placeId },
    create: {
      id: data.placeId,
      name: data.name,
      address: data.address,
      lat: data.lat,
      lng: data.lng,
      rating: data.rating ?? null,
      types: types ?? null,
      photoName: data.photoName ?? null,
    },
    update: {
      name: data.name,
      address: data.address,
      lat: data.lat,
      lng: data.lng,
      rating: data.rating ?? null,
      ...(types !== undefined ? { types } : {}),
      ...(data.photoName !== undefined ? { photoName: data.photoName } : {}),
    },
  });

  await prisma.placeQuery.upsert({
    where: { query },
    create: { query, placeId: data.placeId },
    update: { placeId: data.placeId },
  });
}

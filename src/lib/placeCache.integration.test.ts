import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { COORDS_MAX_AGE_MS, lookupByPlaceId, lookupByQuery, upsertPlace } from "./placeCache";

// Story: the place cache may keep only what the Google terms allow (ADR-0004):
// which place a query found (forever) and that place's coordinates (30 days).
// A row written before keeps old Google content; the next write clears it.

const stamp = Date.now();
const placeId = `cache-${stamp}`;

afterAll(async () => {
  await prisma.placeQuery.deleteMany({ where: { placeId } });
  await prisma.place.deleteMany({ where: { id: placeId } });
});

describe("the place cache", () => {
  it("keeps the place ID and coordinates, nothing else", async () => {
    await upsertPlace(`${placeId} 東京`, { placeId, lat: 35.68, lng: 139.77 });

    const row = await prisma.place.findUniqueOrThrow({ where: { id: placeId } });
    expect(row).toMatchObject({ lat: 35.68, lng: 139.77 });
    expect(row.coordsFetchedAt).toBeInstanceOf(Date);
    expect(await lookupByQuery(`${placeId} 東京`)).toEqual({ placeId, lat: 35.68, lng: 139.77 });
  });

  it("reads coordinates older than 30 days as missing, but still knows the place", async () => {
    await prisma.place.update({
      where: { id: placeId },
      data: { coordsFetchedAt: new Date(Date.now() - COORDS_MAX_AGE_MS - 60_000) },
    });

    expect(await lookupByQuery(`${placeId} 東京`)).toEqual({ placeId, lat: null, lng: null });
    expect(await lookupByPlaceId(placeId)).toEqual({ placeId, lat: null, lng: null });
  });
});

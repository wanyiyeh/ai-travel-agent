import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { upsertPlace } from "./placeCache";

// Story: a restaurant was first cached from a Nearby Search (which carries a
// rating), then the same place gets re-resolved by a Text Search, which no
// longer asks for ratings. The rating must survive the second write.
describe("upsertPlace keeps an existing rating", () => {
  const placeId = `rating-keep-${Date.now()}`;
  const base = { placeId, name: "Rating Keeper", address: "Somewhere", lat: 1, lng: 2 };

  afterAll(async () => {
    await prisma.placeQuery.deleteMany({ where: { placeId } });
    await prisma.place.deleteMany({ where: { id: placeId } });
  });

  it("doesn't overwrite a stored rating with a missing one", async () => {
    await upsertPlace(`${placeId} nearby`, { ...base, rating: 4.4 });
    await upsertPlace(`${placeId} text`, { ...base, rating: null });
    await upsertPlace(`${placeId} text2`, { ...base });

    const row = await prisma.place.findUnique({ where: { id: placeId } });
    expect(row?.rating).toBe(4.4);
  });

  it("still updates the rating when a new one is supplied", async () => {
    await upsertPlace(`${placeId} nearby2`, { ...base, rating: 4.7 });

    const row = await prisma.place.findUnique({ where: { id: placeId } });
    expect(row?.rating).toBe(4.7);
  });
});

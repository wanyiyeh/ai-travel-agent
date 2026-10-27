import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, j } from "@/lib/db";
import { signInAs } from "@tests/setup/mockAuth";
import { DELETE } from "./route";
import { POST as restore } from "./restore/route";
import { POST as select } from "./select/route";

// Story (#292): a traveler who doesn't want the afternoon snack had no way
// to drop it — the slot stayed, and it blocked dragging dinner before it.

const stamp = Date.now();
const owner = { id: `md-owner-${stamp}`, email: `md-owner-${stamp}@example.com` };
const itineraryId = `md-trip-${stamp}`;
const dayId = `md-day-${stamp}`;

beforeAll(async () => {
  await prisma.user.create({ data: owner });
  await prisma.itinerary.create({
    data: {
      id: itineraryId,
      userId: owner.id,
      title: "Hermanus",
      config: j({}),
      days: j([
        {
          id: dayId,
          day: 1,
          stops: [],
          meals: { snack: { name: "Gelato" }, dinner: { name: "Booked", fixedEvent: { type: "restaurant", startTime: "19:00", endTime: "20:30" } } },
          mealPositions: { lunch: 0, snack: 0, dinner: 0 },
        },
      ]),
    },
  });
});

beforeEach(() => signInAs(owner)); // signed out after each test (tests/setup/mockAuth.ts)

const req = (body: unknown) => new Request("http://test", { method: "POST", body: JSON.stringify(body) });
const params = (mealType: string) => ({ params: Promise.resolve({ dayId, mealType }) });
const savedDay = async () =>
  ((await prisma.itinerary.findUniqueOrThrow({ where: { id: itineraryId } })).days as Record<string, unknown>[])[0];

describe("deleting a meal", () => {
  it("removes it, its position, and leaves no slot for it", async () => {
    expect((await DELETE(req({ itineraryId }), params("snack"))).status).toBe(200);
    const day = await savedDay();
    expect(day.meals).not.toHaveProperty("snack");
    expect(day.mealPositions).toEqual({ lunch: 0, dinner: 0 });
    expect(day.skippedMeals).toEqual(["snack"]);
  });

  it("keeps a reservation", async () => {
    expect((await DELETE(req({ itineraryId }), params("dinner"))).status).toBe(400);
    expect((await savedDay()).meals).toHaveProperty("dinner");
  });

  it("brings it back as an empty slot", async () => {
    expect((await restore(req({ itineraryId }), params("snack"))).status).toBe(200);
    expect((await savedDay()).skippedMeals).toEqual([]);
  });

  it("brings it back when a place is picked for it", async () => {
    await DELETE(req({ itineraryId }), params("snack"));
    const res = await select(req({ itineraryId, meal: { name: "Cafe", description: "" } }), params("snack"));
    expect(res.status).toBe(200);
    const day = await savedDay();
    expect(day.skippedMeals).toEqual([]);
    expect((day.meals as Record<string, { name: string }>).snack.name).toBe("Cafe");
  });
});

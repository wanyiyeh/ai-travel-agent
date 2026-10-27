import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, j } from "@/lib/db";
import { signInAs } from "@tests/setup/mockAuth";
import { POST as reorder } from "./route";
import { POST as recalculate } from "@/app/api/v1/days/[dayId]/recalculate-transport/route";

// Story (#287): a friend wanted a sunset viewpoint after dinner. Dinner was
// pinned to the end of the day, so no stop could follow it. Now the meal goes
// where it's dragged, and the stops after it read as evening.

const stamp = Date.now();
const owner = { id: `mp-owner-${stamp}`, email: `mp-owner-${stamp}@example.com` };
const itineraryId = `mp-trip-${stamp}`;
const dayId = `mp-day-${stamp}`;
const stop = (id: string) => ({ id, name: id, description: "", duration_minutes: 60 });

beforeAll(async () => {
  await prisma.user.create({ data: owner });
  await prisma.itinerary.create({
    data: {
      id: itineraryId,
      userId: owner.id,
      title: "Hermanus",
      config: j({}),
      days: j([{ id: dayId, day: 1, stops: ["a", "b", "c", "d"].map(stop), meals: { lunch: { name: "L" }, dinner: { name: "D" } } }]),
    },
  });
});

beforeEach(() => signInAs(owner)); // signed out after each test (tests/setup/mockAuth.ts)

const post = (body: unknown) => new Request("http://test", { method: "POST", body: JSON.stringify(body) });
const savedDay = async () =>
  (
    (await prisma.itinerary.findUniqueOrThrow({ where: { id: itineraryId } })).days as {
      mealPositions?: unknown;
      stops: { id: string; time_of_day?: string }[];
    }[]
  )[0];

describe("dragging meals", () => {
  it("saves where the meals were put, and keeps them when only stops move", async () => {
    expect((await reorder(post({ itineraryId, days: [{ dayId, stopIds: ["a", "b", "c", "d"], mealPositions: { lunch: 1, dinner: 3 } }] }))).status).toBe(200);
    const moved = await savedDay();
    expect(moved.mealPositions).toEqual({ lunch: 1, dinner: 3 });
    // the time of day follows the meals right away, with no transport recalculation
    expect(moved.stops.map((s) => s.time_of_day)).toEqual(["morning", "afternoon", "afternoon", "evening"]);

    expect((await reorder(post({ itineraryId, days: [{ dayId, stopIds: ["b", "a", "c", "d"] }] }))).status).toBe(200);
    const day = await savedDay();
    expect(day.stops.map((s) => s.id)).toEqual(["b", "a", "c", "d"]);
    expect(day.mealPositions).toEqual({ lunch: 1, dinner: 3 });
  });

  it("splits the day at lunch and dinner when recalculating", async () => {
    const res = await recalculate(post({ itineraryId }), { params: Promise.resolve({ dayId }) });
    expect(res.status).toBe(200);
    expect((await savedDay()).stops.map((s) => s.time_of_day)).toEqual(["morning", "afternoon", "afternoon", "evening"]);
  });
});

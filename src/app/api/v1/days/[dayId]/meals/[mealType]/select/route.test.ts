import { beforeEach, describe, expect, it, vi } from "vitest";
import { signInAs } from "@tests/setup/mockAuth";

const findFirst = vi.fn<() => Promise<unknown>>();
const update = vi.fn<(args: { data: { days: Array<{ meals: Record<string, unknown> }> } }) => Promise<unknown>>(async () => ({}));
vi.mock("@/lib/db", () => ({ prisma: { itinerary: { findFirst, update } }, j: (v: unknown) => v }));
vi.mock("@/lib/placeCache", () => ({ upsertPlace: async () => {} }));

const { POST } = await import("./route");

const params = { params: Promise.resolve({ dayId: "d1", mealType: "lunch" }) };
const select = (meal: Record<string, unknown>) =>
  POST(new Request("http://test/api", { method: "POST", body: JSON.stringify({ itineraryId: "i1", meal }) }), params);
const booking = { type: "reservation", startTime: "12:00", endTime: "13:30" };

beforeEach(() => {
  update.mockClear();
  signInAs({ id: "u1", email: "u1@example.com" });
  // Lunch is a reservation (固定行程).
  findFirst.mockResolvedValue({
    id: "i1",
    userId: "u1",
    days: [{ id: "d1", meals: { lunch: { name: "叙々苑 新宿", placeId: "jojoen", estimated_cost: 6000, fixedEvent: booking } } }],
  });
});

describe("POST /meals/[mealType]/select — a reservation", () => {
  it("refuses another restaurant", async () => {
    const res = await select({ name: "一蘭", placeId: "ichiran" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("訂好位的餐廳不能換成別家");
    expect(update).not.toHaveBeenCalled();
  });

  it("takes a price edit and keeps it a reservation", async () => {
    const res = await select({ name: "叙々苑 新宿", placeId: "jojoen", estimated_cost: 8000 });
    expect(res.status).toBe(200);
    const saved = update.mock.calls[0][0].data.days[0].meals.lunch;
    expect(saved).toMatchObject({ estimated_cost: 8000, fixedEvent: booking });
  });
});

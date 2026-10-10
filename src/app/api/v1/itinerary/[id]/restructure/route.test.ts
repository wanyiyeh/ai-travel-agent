import { beforeEach, describe, expect, it, vi } from "vitest";
import { signInAs } from "@tests/setup/mockAuth";

const findFirst = vi.fn();

// Only the validation paths are exercised here, which return before any
// OpenAI work or quota charge — the mocks just keep module loading hermetic
// (openai.ts throws at import time without OPENAI_API_KEY).
vi.mock("@/lib/openai", () => ({ openai: {} }));
const chargeMock = vi.fn();
vi.mock("@/lib/quota", () => ({ chargePaidEdit: (...args: unknown[]) => chargeMock(...args) }));
vi.mock("@/lib/db", () => ({
  prisma: { itinerary: { findFirst: (...args: unknown[]) => findFirst(...args) } },
  j: (v: unknown) => v,
}));

const { POST } = await import("./route");

function restructure(cities: unknown[]) {
  return POST(
    new Request("http://test/api", { method: "POST", body: JSON.stringify({ cities }) }),
    { params: Promise.resolve({ id: "itin-1" }) },
  );
}

const city = (targetDays: number) => ({ name: "京都", isNew: true, targetDays });

beforeEach(() => {
  findFirst.mockReset();
  signInAs({ id: "u1", email: "u1@example.com" });
  findFirst.mockResolvedValue(null);
});

describe("restructure input limits", () => {
  it("passes validation for a trip within the limits", async () => {
    const res = await restructure([city(14), city(14)]);
    // Gets as far as the itinerary lookup (mocked as not found).
    expect(res.status).toBe(404);
    expect(findFirst).toHaveBeenCalled();
  });

  it("rejects a city over the per-city day cap", async () => {
    const res = await restructure([city(15)]);
    expect(res.status).toBe(400);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("rejects a trip whose cities add up to more than the trip cap", async () => {
    const res = await restructure([city(14), city(14), city(3)]);
    expect(res.status).toBe(400);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("rejects an oversized city name", async () => {
    const res = await restructure([{ ...city(2), name: "a".repeat(201) }]);
    expect(res.status).toBe(400);
  });
});

describe("restructure keeps a booked event's day", () => {
  const concert = { type: "concert", date: "2026-11-12", startTime: "18:00", venueName: "東京巨蛋" };
  const concertStop = {
    name: "東京巨蛋",
    fixedEvent: { type: "concert", startTime: "18:00", endTime: "21:00", arriveBy: "17:00" },
  };

  beforeEach(() => {
    chargeMock.mockReset();
    findFirst.mockResolvedValue({
      id: "itin-1",
      userId: "u1",
      config: { preferences: { fixedEvents: [concert] } },
      days: [
        { id: "d1", day: 1, waypointCity: "東京", stops: [{ name: "淺草寺" }] },
        { id: "d2", day: 2, waypointCity: "東京", stops: [{ name: "上野公園" }, concertStop] },
        { id: "d3", day: 3, waypointCity: "東京", stops: [] },
      ],
    });
  });

  it("refuses to drop it, without charging the edit", async () => {
    const res = await restructure([{ name: "東京", isNew: false, targetDays: 2, keepDayIds: ["d1", "d3"] }]);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("第 2 天有固定行程（演唱會 11/12），不能移除");
    expect(chargeMock).not.toHaveBeenCalled();
  });
});

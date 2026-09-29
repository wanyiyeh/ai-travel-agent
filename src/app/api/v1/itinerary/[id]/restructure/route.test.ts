import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();

// Only the request-validation path is exercised here, which returns before
// any DB or OpenAI work — the mocks just keep module loading hermetic
// (openai.ts throws at import time without OPENAI_API_KEY).
vi.mock("@/lib/openai", () => ({ openai: {} }));
vi.mock("@/lib/db", () => ({
  prisma: { itinerary: { findUnique: (...args: unknown[]) => findUnique(...args) } },
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
  findUnique.mockReset();
  findUnique.mockResolvedValue(null);
});

describe("restructure input limits", () => {
  it("passes validation for a trip within the limits", async () => {
    const res = await restructure([city(14), city(14)]);
    // Gets as far as the itinerary lookup (mocked as not found).
    expect(res.status).toBe(404);
    expect(findUnique).toHaveBeenCalled();
  });

  it("rejects a city over the per-city day cap", async () => {
    const res = await restructure([city(15)]);
    expect(res.status).toBe(400);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects a trip whose cities add up to more than the trip cap", async () => {
    const res = await restructure([city(14), city(14), city(3)]);
    expect(res.status).toBe(400);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects an oversized city name", async () => {
    const res = await restructure([{ ...city(2), name: "a".repeat(201) }]);
    expect(res.status).toBe(400);
  });
});

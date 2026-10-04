import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

const createMock = vi.fn();
const nearbyMock = vi.fn();
const lodgingMock = vi.fn();

vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
}));
vi.mock("@/lib/placesTextSearch", () => ({
  getCityCenter: async () => ({ lat: 35.01, lng: 135.77 }),
}));
// Fixed rate so budget ranking is deterministic and nothing hits the network.
vi.mock("@/lib/exchangeRate", () => ({ getTwdRates: async () => ({ TWD: 1, JPY: 0.2 }) }));
vi.mock("@/lib/fetchCityRestaurants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fetchCityRestaurants")>()),
  fetchNearbyPlaceCandidates: (...args: unknown[]) => nearbyMock(...args),
  fetchLodgingCandidates: (...args: unknown[]) => lodgingMock(...args),
}));

const { generateMealsAndAccommodation } = await import("./itineraryCityGen");

function place(name: string): PlaceCandidate {
  return { name, placeId: `pid-${name}`, lat: 35, lng: 135.7, address: "addr", rating: 4.1, priceLevel: 2 };
}

function mockLlm(json: unknown) {
  createMock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(json) } }] });
}

function systemPrompt(): string {
  return createMock.mock.calls[0][0].messages[0].content;
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "key");
  createMock.mockReset();
  nearbyMock.mockReset();
  lodgingMock.mockReset();
  lodgingMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateMealsAndAccommodation", () => {
  it("offers real candidates to the model and carries the picked place data through", async () => {
    // café pool (shared by breakfast and snack), then main; lodging has its own fetch
    nearbyMock
      .mockResolvedValueOnce([place("Cafe A"), place("Gelato Q")])
      .mockResolvedValueOnce([place("Ramen X"), place("Sushi Y")]);
    lodgingMock.mockResolvedValueOnce([place("Hotel H")]);
    mockLlm({
      accommodation: { id: "H1", name: "Hotel H", area: "Gion" },
      meals: [{ breakfast: { id: "B1" }, lunch: { id: "M1" }, dinner: { id: "M2" }, snack: { id: "S1" } }],
    });

    const result = await generateMealsAndAccommodation("京都", 1, "JPY", "moderate");

    expect(nearbyMock).toHaveBeenCalledTimes(2);
    expect(lodgingMock).toHaveBeenCalledTimes(1);
    expect(systemPrompt()).toContain("M2: Sushi Y");
    // the shared café pool is split, no store offered for both meals
    expect(systemPrompt()).toContain("B1: Cafe A");
    expect(systemPrompt()).toContain("S1: Gelato Q");
    expect(result.accommodation.placeId).toBe("pid-Hotel H");
    expect((result.mealsByDay[0].dinner as Record<string, unknown>).placeId).toBe("pid-Sushi Y");
  });

  it("searches each pool once, and only lunch/dinner on Enterprise fields", async () => {
    nearbyMock.mockResolvedValue([]);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("小鎮", 1, "JPY", "luxury");

    // One café search (breakfast + snack) and one main-meal search (no
    // price-filter retry: Nearby Search never supported that filter). Tier is
    // the 6th argument. Lodging goes through fetchLodgingCandidates (Pro-only).
    expect(nearbyMock.mock.calls.map((c) => c[5])).toEqual(["pro", "enterprise"]);
    expect(lodgingMock.mock.calls[0][2]).toBe("luxury");
  });

  it("offers only in-budget lunch/dinner places when there are enough of them", async () => {
    const priced = (name: string, start: number, end: number): PlaceCandidate => ({
      ...place(name),
      priceRange: { currency: "JPY", start, end },
    });
    // budget cap NT$400 = ¥2,000 at the mocked 0.2 rate
    nearbyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([priced("Kaiseki", 15000, 30000), priced("Ramen", 900, 1200), priced("Udon", 600, 900)]);
    mockLlm({ accommodation: {}, meals: [{ lunch: { id: "M1" }, dinner: { id: "M2" } }] });

    const result = await generateMealsAndAccommodation("京都", 1, "JPY", "budget");

    expect(systemPrompt()).not.toContain("Kaiseki");
    expect(systemPrompt()).toContain("M1: Ramen");
    // estimated cost comes from Google's range midpoint, not the priceLevel table
    expect((result.mealsByDay[0].lunch as Record<string, unknown>).estimated_cost).toBe(1050);
  });

  it("falls back to the invent-the-names prompt when there are no candidates", async () => {
    nearbyMock.mockResolvedValue([]);
    mockLlm({ accommodation: { name: "Some Hotel", area: "X" }, meals: [{ lunch: { name: "Some Place" } }] });

    const result = await generateMealsAndAccommodation("小鎮", 1, "JPY");

    expect(systemPrompt()).not.toContain("候選");
    expect(result.accommodation).toEqual({ name: "Some Hotel", area: "X" });
    expect(result.mealsByDay[0]).toEqual({ lunch: { name: "Some Place" } });
  });

  it("skips the Places lookup entirely without an API key", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "");
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("京都", 1, "JPY");

    expect(nearbyMock).not.toHaveBeenCalled();
    expect(lodgingMock).not.toHaveBeenCalled();
  });
});

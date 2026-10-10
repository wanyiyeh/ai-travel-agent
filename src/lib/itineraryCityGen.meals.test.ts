import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

const createMock = vi.fn();
const nearbyMock = vi.fn();
const lodgingMock = vi.fn();
const luxuryMock = vi.fn();
const textMock = vi.fn();

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
  fetchLuxuryRestaurants: (...args: unknown[]) => luxuryMock(...args),
  searchTextCandidates: (...args: unknown[]) => textMock(...args),
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
  // A search a test didn't set up finds nothing.
  nearbyMock.mockResolvedValue([]);
  lodgingMock.mockReset();
  lodgingMock.mockResolvedValue([]);
  luxuryMock.mockReset();
  luxuryMock.mockResolvedValue([]);
  textMock.mockReset();
  textMock.mockResolvedValue([]);
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
    // price-filter retry: Nearby Search never supported that filter); with no
    // restaurants found, one more by primary type. Tier is the 6th argument.
    // Lodging goes through fetchLodgingCandidates (Pro-only).
    expect(nearbyMock.mock.calls.map((c) => c[5])).toEqual(["pro", "enterprise", "enterprise"]);
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

  it("vegetarian: searches vegetarian restaurants first and drops steak/seafood places", async () => {
    const typed = (name: string, primary: string): PlaceCandidate => ({ ...place(name), types: [primary, "restaurant"] });
    nearbyMock
      .mockResolvedValueOnce([]) // cafés
      .mockResolvedValueOnce([typed("Steak House", "steak_house"), typed("Noodles", "ramen_restaurant")]) // main
      .mockResolvedValueOnce([typed("Green Table", "vegetarian_restaurant")]); // vegetarian search
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("京都", 1, "JPY", undefined, { dietaryRestrictions: ["vegetarian"] });

    expect(nearbyMock.mock.calls[2][2]).toEqual(["vegetarian_restaurant", "vegan_restaurant"]);
    expect(systemPrompt()).toContain("M1: Green Table");
    expect(systemPrompt()).toContain("M2: Noodles");
    expect(systemPrompt()).not.toContain("Steak House");
    expect(systemPrompt()).toContain("旅客飲食限制：素食");
  });

  it("late riser: brunch places lead the breakfast list and the prompt says so", async () => {
    const typed = (name: string, primary: string): PlaceCandidate => ({ ...place(name), types: [primary] });
    nearbyMock
      .mockResolvedValueOnce([typed("Cafe", "cafe"), typed("Gelato", "ice_cream_shop"), typed("Brunch Spot", "brunch_restaurant")])
      .mockResolvedValueOnce([]);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("京都", 1, "JPY", undefined, { startTimePreference: "late" });

    expect(systemPrompt()).toContain("B1: Brunch Spot");
    expect(systemPrompt()).toContain("早餐請選早午餐");
  });

  it("asks for a long stay in chunks, and a failed chunk still gets real meals", async () => {
    const restaurants = Array.from({ length: 20 }, (_, i) => place(`Restaurant ${i}`));
    nearbyMock
      .mockResolvedValueOnce([place("Cafe A"), place("Cafe B")])
      .mockResolvedValueOnce(restaurants);
    lodgingMock.mockResolvedValueOnce([place("Hotel H")]);
    mockLlm({ accommodation: { id: "H1" }, meals: [] }); // days 1-5
    createMock.mockRejectedValueOnce(new Error("timeout")); // days 6-7

    const result = await generateMealsAndAccommodation("斯德哥爾摩", 7, "SEK", "moderate");

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[1][0].messages[0].content).toContain("住宿已經決定");
    expect(result.accommodation.placeId).toBe("pid-Hotel H");
    expect(result.mealsByDay).toHaveLength(7);
    for (const day of result.mealsByDay) {
      expect((day.lunch as Record<string, unknown>).placeId).toMatch(/^pid-Restaurant/);
      expect((day.dinner as Record<string, unknown>).placeId).toMatch(/^pid-Restaurant/);
    }
  });

  it("luxury: offers price-filtered restaurants ahead of the popular casual ones", async () => {
    const priced = (name: string, start: number, end: number): PlaceCandidate => ({
      ...place(name),
      types: ["japanese_restaurant"],
      priceRange: { currency: "JPY", start, end },
    });
    nearbyMock
      .mockResolvedValueOnce([]) // cafés
      .mockResolvedValueOnce([priced("Ramen", 1000, 2000), priced("Curry", 1000, 2000)]); // popularity pool
    luxuryMock.mockResolvedValueOnce([priced("Kaiseki", 6000, 9000), priced("Teppanyaki", 7000, 10000)]);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 1, "JPY", "luxury");

    expect(luxuryMock).toHaveBeenCalledTimes(1);
    // ¥6,000-9,000 at the mocked 0.2 rate = NT$1,200-1,800: inside the luxury range
    expect(systemPrompt()).toContain("M1: Kaiseki");
    expect(systemPrompt()).toContain("M2: Teppanyaki");
  });

  it("doesn't pay for the luxury search on other budgets", async () => {
    nearbyMock.mockResolvedValue([]);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 1, "JPY", "moderate");

    expect(luxuryMock).not.toHaveBeenCalled();
  });

  it("searches Tokyo's lodging and meals in the budget's district, other cities around the center", async () => {
    nearbyMock.mockResolvedValue([]);
    mockLlm({ accommodation: {}, meals: [] });
    await generateMealsAndAccommodation("東京", 1, "JPY", "budget");
    expect(nearbyMock.mock.calls[0][0]).toEqual({ lat: 35.714, lng: 139.787 });
    expect(lodgingMock.mock.calls[0][0]).toEqual({ lat: 35.714, lng: 139.787 });

    nearbyMock.mockClear();
    mockLlm({ accommodation: {}, meals: [] });
    await generateMealsAndAccommodation("京都", 1, "JPY", "budget");
    expect(nearbyMock.mock.calls[0][0]).toEqual({ lat: 35.01, lng: 135.77 }); // mocked city center
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

describe("generateMealsAndAccommodation — 飲品 (drinks)", () => {
  const typed = (name: string, type: string) => ({ ...place(name), types: [type] });
  const coffee = [typed("Glitch Coffee", "coffee_shop"), typed("Starbucks Coffee", "coffee_shop"), typed("Onibus", "coffee_shop")];
  const tea = [typed("中村藤吉", "tea_house"), typed("抹茶甘味処", "dessert_shop")];
  const byQuery = async (query: string) => (query === "specialty coffee" ? coffee : tea);
  const snacks = (days: Array<Record<string, unknown>>) => days.map((d) => (d.snack as { name: string }).name);

  it("searches each chosen drink once, with Google's rating filter", async () => {
    nearbyMock.mockResolvedValue([]);
    textMock.mockImplementation(byQuery);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("京都", 2, "JPY", undefined, { drinks: ["coffee", "tea"] });

    expect(textMock.mock.calls.map((c) => [c[0], c[5]])).toEqual([
      ["specialty coffee", { minRating: 3.5 }],
      ["matcha", { minRating: 3.5 }],
    ]);
  });

  it("alternates coffee and tea for the snack and leaves out global chains", async () => {
    nearbyMock.mockResolvedValue([typed("Gelato Q", "ice_cream_shop")]);
    textMock.mockImplementation(byQuery);
    mockLlm({ accommodation: {}, meals: [] });

    const result = await generateMealsAndAccommodation("京都", 4, "JPY", undefined, { drinks: ["coffee", "tea"] });

    // Coffee places also lead breakfast, so which coffee place is the snack varies.
    const kind = (name: string) => (coffee.some((p) => p.name === name) ? "coffee" : tea.some((p) => p.name === name) ? "tea" : name);
    expect(snacks(result.mealsByDay).map(kind)).toEqual(["coffee", "tea", "coffee", "tea"]);
    expect(JSON.stringify(result.mealsByDay)).not.toContain("Starbucks");
  });

  it("puts coffee places first in a coffee lover's breakfast list", async () => {
    nearbyMock.mockResolvedValue([typed("Bakery B", "bakery")]);
    textMock.mockImplementation(byQuery);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("京都", 1, "JPY", undefined, { drinks: ["coffee"] });

    expect(systemPrompt()).toContain("早餐候選：\nB1: Glitch Coffee");
  });

  it("tells the model which snack candidates each day should come from", async () => {
    nearbyMock.mockResolvedValue([]);
    textMock.mockImplementation(byQuery);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("京都", 2, "JPY", undefined, { drinks: ["coffee", "tea"] });

    expect(systemPrompt()).toContain("旅客選了飲品，點心照天數從這些候選選：第 1 天：S1、S3；第 2 天：S2、S4");
  });

  it("makes no drink search when none was chosen", async () => {
    nearbyMock.mockResolvedValue([]);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("京都", 1, "JPY");

    expect(textMock).not.toHaveBeenCalled();
  });
});

describe("generateMealsAndAccommodation — 小酌 (nightcap)", () => {
  const typed = (name: string, type: string) => ({ ...place(name), types: [type] });
  const bars = [typed("Bar Benfiddich", "cocktail_bar"), typed("鳥貴族", "japanese_izakaya_restaurant"), typed("Cafe X", "cafe"), typed("Wine Bar Two", "wine_bar")];
  // café pool, main pool, then bars — the order fetchMealLodgingPools searches in
  const byTypes = async (_c: unknown, _k: unknown, types: string[]) =>
    types.includes("bar") ? bars : types.includes("cafe") ? [typed("Gelato Q", "ice_cream_shop")] : [typed("鳥貴族", "japanese_izakaya_restaurant"), typed("Ramen X", "ramen_restaurant")];

  it("searches bars and izakaya once and fills a 小酌 every night from them", async () => {
    nearbyMock.mockImplementation(byTypes);
    mockLlm({ accommodation: {}, meals: [] });

    const result = await generateMealsAndAccommodation("東京", 2, "JPY", undefined, { drinks: ["alcohol"] });

    const barSearches = nearbyMock.mock.calls.filter((c) => (c[2] as string[]).includes("bar"));
    expect(barSearches).toHaveLength(1);
    expect(barSearches[0][6]).toBe("primary");
    const nightcaps = result.mealsByDay.map((d) => (d.nightcap as { name: string } | undefined)?.name);
    expect(nightcaps).toEqual(["Bar Benfiddich", "Wine Bar Two"]);
  });

  it("doesn't offer an izakaya from the dinner list again as the same evening's 小酌", async () => {
    nearbyMock.mockImplementation(byTypes);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 1, "JPY", undefined, { drinks: ["alcohol"] });

    expect(systemPrompt()).toContain("小酌候選：\nN1: Bar Benfiddich");
    expect(systemPrompt()).not.toMatch(/N\d: 鳥貴族/);
  });

  it("asks for a 小酌 only from a traveler who picked 酒", async () => {
    nearbyMock.mockImplementation(byTypes);
    mockLlm({ accommodation: {}, meals: [] });

    const result = await generateMealsAndAccommodation("東京", 1, "JPY");

    expect(systemPrompt()).not.toContain("nightcap");
    expect(systemPrompt()).not.toContain("小酌候選");
    expect(result.mealsByDay[0].nightcap).toBeUndefined();
  });

  it("prices a 小酌 with no price data at the middle of its range", async () => {
    nearbyMock.mockImplementation(byTypes);
    mockLlm({ accommodation: {}, meals: [] });

    const result = await generateMealsAndAccommodation("東京", 1, "JPY", undefined, { drinks: ["alcohol"] });

    expect((result.mealsByDay[0].nightcap as { estimated_cost?: number }).estimated_cost).toBe(2250);
  });
});

describe("generateMealsAndAccommodation — 自駕", () => {
  it("keeps the 小酌 for a self-driver, with a reminder not to drive after it", async () => {
    const bar = { ...place("Bar"), types: ["cocktail_bar"] };
    nearbyMock.mockImplementation(async (_c: unknown, _k: unknown, types: string[]) => (types.includes("bar") ? [bar] : []));
    mockLlm({ accommodation: {}, meals: [{ nightcap: { id: "N1", description: "很棒的酒吧" } }] });

    const result = await generateMealsAndAccommodation("東京", 1, "JPY", undefined, { drinks: ["alcohol"], selfDrive: true });

    expect((result.mealsByDay[0].nightcap as { description: string }).description).toBe("很棒的酒吧。開車的話請不要喝酒，可以把車留在住宿");
  });
});

// 親子 (plan/form-preference-wiring.md 1.5).
describe("generateMealsAndAccommodation — with children", () => {
  const kidsPlace = (name: string): PlaceCandidate => ({ ...place(name), goodForChildren: true });

  it("asks whether lunch/dinner places suit children, and offers those first", async () => {
    nearbyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([place("Izakaya"), kidsPlace("Family Diner")]);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 1, "JPY", undefined, { kids: true });

    expect(nearbyMock.mock.calls.map((c) => c[5])).toEqual(["pro", "kids"]);
    expect(systemPrompt()).toContain("M1: Family Diner");
    expect(systemPrompt()).toContain("有小孩同行");
  });

  it("leaves hostels out of the lodging", async () => {
    nearbyMock.mockResolvedValue([]);
    lodgingMock.mockResolvedValueOnce([
      { ...place("Dorm Hostel"), types: ["hostel", "lodging"] },
      { ...place("Family Inn"), types: ["guest_house", "lodging"] },
    ]);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 1, "JPY", "budget", { kids: true });

    expect(systemPrompt()).toContain("Family Inn");
    expect(systemPrompt()).not.toContain("Dorm Hostel");
  });
});

describe("generateMealsAndAccommodation — with older relatives", () => {
  it("leaves hostels out of the lodging", async () => {
    nearbyMock.mockResolvedValue([]);
    lodgingMock.mockResolvedValueOnce([
      { ...place("Dorm Hostel"), types: ["hostel", "lodging"] },
      { ...place("Quiet Inn"), types: ["japanese_inn", "lodging"] },
    ]);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 1, "JPY", "budget", { seniors: true });

    expect(systemPrompt()).toContain("Quiet Inn");
    expect(systemPrompt()).not.toContain("Dorm Hostel");
  });
});

// 獨旅 (plan 1.5).
describe("generateMealsAndAccommodation — traveling alone", () => {
  const typed = (name: string, types: string[], lat = 35, lng = 135.7): PlaceCandidate => ({ ...place(name), types, lat, lng });

  it("offers places easy to eat at alone first, and says so in the prompt", async () => {
    nearbyMock.mockImplementation(async (_c: unknown, _k: unknown, types: string[]) =>
      types.includes("ramen_restaurant") || types.includes("restaurant")
        ? [typed("Hot Pot House", ["hot_pot_restaurant"]), typed("Ramen Bar", ["ramen_restaurant"])]
        : []
    );
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 1, "JPY", undefined, { solo: true });

    expect(systemPrompt()).toContain("M1: Ramen Bar");
    expect(systemPrompt()).toContain("一個人旅行");
  });

  it("searches stations once and puts lodging near one first", async () => {
    nearbyMock.mockImplementation(async (_c: unknown, _k: unknown, types: string[]) =>
      types.includes("train_station") ? [{ ...place("Station"), lat: 35.0, lng: 135.7 }] : []
    );
    lodgingMock.mockResolvedValueOnce([
      typed("Far Hotel", ["hotel"], 35.02, 135.7), // ~2.2km from the station
      typed("Station Hotel", ["hotel"], 35.002, 135.7), // ~220m
    ]);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 1, "JPY", undefined, { solo: true });

    expect(nearbyMock.mock.calls.filter((c) => (c[2] as string[]).includes("train_station"))).toHaveLength(1);
    expect(systemPrompt().indexOf("Station Hotel")).toBeLessThan(systemPrompt().indexOf("Far Hotel"));
  });

  it("looks for no station on other trips", async () => {
    nearbyMock.mockResolvedValue([]);
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 1, "JPY", undefined, {});

    expect(nearbyMock.mock.calls.some((c) => (c[2] as string[]).includes("train_station"))).toBe(false);
  });
});

// Story: around 新宿, half the 20 "restaurants" were malls, a cinema, hotels and
// 新宿黃金街 — 8 real ones for 8 meals, so 獨旅 and 親子 trips repeated day 1's.
describe("generateMealsAndAccommodation — too few restaurants", () => {
  const typed = (name: string, types: string[]): PlaceCandidate => ({ ...place(name), types });
  const mall = typed("Mall", ["department_store", "restaurant"]);

  it("searches once more, by primary type, when the pool can't cover every lunch and dinner", async () => {
    nearbyMock.mockImplementation(async (_c: unknown, _k: unknown, types: string[], _r: unknown, _n: unknown, _t: unknown, match?: string) =>
      match === "primary"
        ? Array.from({ length: 6 }, (_, i) => typed(`Ramen ${i}`, ["ramen_restaurant"]))
        : types.includes("restaurant")
          ? [mall, typed("Sushi", ["sushi_restaurant"])]
          : []
    );
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 2, "JPY", undefined, {});

    const extra = nearbyMock.mock.calls.find((c) => c[6] === "primary");
    expect(extra?.[2]).toContain("ramen_restaurant");
    expect(extra?.[2]).not.toContain("restaurant");
    expect(systemPrompt()).toContain("Ramen 0");
    expect(systemPrompt()).not.toContain("Mall");
  });

  it("doesn't search again when there are enough", async () => {
    nearbyMock.mockImplementation(async (_c: unknown, _k: unknown, types: string[]) =>
      types.includes("restaurant") ? Array.from({ length: 4 }, (_, i) => typed(`Sushi ${i}`, ["sushi_restaurant"])) : []
    );
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 2, "JPY", undefined, {});

    expect(nearbyMock.mock.calls.some((c) => c[6] === "primary")).toBe(false);
  });
});

// 親子: ramen with a mild soup is fine (chicken or tonkotsu), spicy isn't.
describe("generateMealsAndAccommodation — ramen with children", () => {
  const ramen = (name: string, extra: Partial<PlaceCandidate> = {}): PlaceCandidate => ({
    ...place(name),
    types: ["ramen_restaurant", "restaurant"],
    ...extra,
  });

  it("offers chicken and tonkotsu ramen first, even when Google says no, and drops spicy ones", async () => {
    nearbyMock.mockImplementation(async (_c: unknown, _k: unknown, types: string[]) =>
      types.includes("ramen_restaurant") || types.includes("restaurant")
        ? [
            ramen("辣麻味噌拉麵 鬼金"),
            ramen("Ramen Kamo to Negi", { goodForChildren: false, menuForChildren: false }),
            ramen("鶏白湯ラーメン 鳥の", { goodForChildren: false }),
            ramen("一蘭 上野店"),
          ]
        : []
    );
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 1, "JPY", undefined, { kids: true });

    const prompt = systemPrompt();
    expect(prompt).toContain("M1: 鶏白湯ラーメン 鳥の");
    expect(prompt).toContain("M2: 一蘭 上野店");
    expect(prompt).not.toContain("鬼金");
    expect(prompt).not.toContain("Kamo to Negi");
    expect(prompt).toContain("雞湯系或豚骨");
  });
});

// 親子: a maid café came up as a 親子 trip's snack (Google types it a plain café).
describe("generateMealsAndAccommodation — snacks with children", () => {
  const typed = (name: string, types: string[]): PlaceCandidate => ({ ...place(name), types });

  it("leaves maid cafés out and offers sweets first", async () => {
    nearbyMock.mockImplementation(async (_c: unknown, _k: unknown, types: string[]) =>
      types.includes("cafe")
        ? [
            typed("Morning Cafe", ["cafe"]),
            typed("at-home cafe 秋葉原本店", ["cafe", "food"]),
            typed("Coffee Stand", ["coffee_shop", "cafe"]),
            typed("壽壽喜園 淺草本店", ["tea_house", "ice_cream_shop", "dessert_shop"]),
          ]
        : []
    );
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 2, "JPY", undefined, { kids: true });

    const prompt = systemPrompt();
    expect(prompt).not.toContain("at-home cafe");
    expect(prompt).toContain("S1: 壽壽喜園 淺草本店");
  });

  it("keeps maid cafés for everyone else", async () => {
    nearbyMock.mockImplementation(async (_c: unknown, _k: unknown, types: string[]) =>
      types.includes("cafe") ? [typed("Morning Cafe", ["cafe"]), typed("at-home cafe 秋葉原本店", ["cafe", "food"])] : []
    );
    mockLlm({ accommodation: {}, meals: [] });

    await generateMealsAndAccommodation("東京", 1, "JPY", undefined, {});

    expect(systemPrompt()).toContain("at-home cafe");
  });
});

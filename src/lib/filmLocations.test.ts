import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

const createMock = vi.fn();
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
}));
const findUniqueMock = vi.fn();
const upsertMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    filmLocationCache: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
  },
}));
const textSearchMock = vi.fn();
vi.mock("@/lib/fetchCityRestaurants", () => ({
  searchTextCandidates: (...args: unknown[]) => textSearchMock(...args),
}));

const { cleanTitles, filmNote, findFilmDay, listFamousWorks, locationsFrom } = await import("@/lib/filmLocations");

const tokyo = { lat: 35.6812, lng: 139.7671 };
const place = (placeId: string, lat: number, lng: number, types = ["tourist_attraction"]): PlaceCandidate => ({
  name: placeId,
  placeId,
  lat,
  lng,
  address: "",
  types,
});
// What Text Search really returned for 「你的名字 聖地巡禮」 (probed), in order.
const yourName = [
  place("四谷須賀神社", 35.6866, 139.7225, ["shinto_shrine", "tourist_attraction"]),
  place("Your Name Stairs", 35.6865, 139.7222),
  place("須賀神社 男段", 35.6866, 139.7226),
  place("LOVE Sculpture", 35.6917, 139.6967),
];
// 「言葉之庭 聖地巡禮」: two spots in 新宿御苑, far enough apart, then one at its other end.
const gardenOfWords = [
  place("舊御涼亭", 35.6825, 139.7108),
  place("新宿御苑", 35.6852, 139.7100),
  place("日本庭園", 35.6829, 139.7076),
];
const aiReturns = (json: unknown) =>
  createMock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(json) } }] });

beforeEach(() => {
  createMock.mockReset();
  findUniqueMock.mockReset();
  upsertMock.mockReset();
  textSearchMock.mockReset();
  findUniqueMock.mockResolvedValue(null);
});

describe("locationsFrom", () => {
  it("keeps one place per spot, and only from the top results", () => {
    const found = locationsFrom(yourName, "你的名字", tokyo, new Set(), []);
    expect(found.map((l) => l.place.placeId)).toEqual(["四谷須賀神社"]); // the sculpture is 4th: not about the film
  });

  it("skips hotels, places far away and places already used", () => {
    const hotel = place("Hotel", 35.68, 139.72, ["lodging", "hotel"]);
    const far = place("Far", 36.5, 139.7);
    const used = place("Used", 35.69, 139.73);
    expect(locationsFrom([hotel, far, used], "x", tokyo, new Set(["Used"]), [])).toEqual([]);
  });
});

describe("findFilmDay", () => {
  it("searches 「<作品> 聖地巡禮」 for each title and titles the day by the one work", async () => {
    textSearchMock.mockResolvedValue(yourName);

    const day = await findFilmDay("東京", tokyo, "key", ["你的名字"], "m", new Set());

    expect(textSearchMock.mock.calls[0].slice(0, 4)).toEqual(["你的名字 聖地巡禮", tokyo, "key", 30000]);
    expect(day?.label).toBe("《你的名字》");
    expect(day?.locations[0].note).toBe("《你的名字》據說曾在這裡取景，出發前可以查證");
    expect(createMock).not.toHaveBeenCalled(); // the traveler named it, no need to ask
  });

  it("is a day even with one location", async () => {
    textSearchMock.mockResolvedValue(yourName);
    expect((await findFilmDay("東京", tokyo, "key", ["你的名字"], "m", new Set()))?.locations).toHaveLength(1);
  });

  it("asks the model only for the city's famous works when none was given", async () => {
    aiReturns({ works: ["你的名字", "言葉之庭"] });
    textSearchMock.mockImplementation(async (q: string) => (q.startsWith("你的名字") ? yourName : gardenOfWords));

    const day = await findFilmDay("東京", tokyo, "key", [], "m", new Set());

    expect(textSearchMock.mock.calls.map((c) => c[0])).toEqual(["你的名字 聖地巡禮", "言葉之庭 聖地巡禮"]);
    expect(day?.label).toBe("影劇朝聖");
    expect(day?.locations.map((l) => l.work)).toEqual(["你的名字", "言葉之庭", "言葉之庭"]);
  });

  it("has no day when nothing is found", async () => {
    textSearchMock.mockResolvedValue([]);
    expect(await findFilmDay("東京", tokyo, "key", ["你的名字"], "m", new Set())).toBeUndefined();
  });
});

describe("listFamousWorks", () => {
  it("caches the works per city, and doesn't cache a failure", async () => {
    aiReturns({ works: ["你的名字"] });
    expect(await listFamousWorks("東京", "m")).toEqual(["你的名字"]);
    expect(upsertMock.mock.calls[0][0].where).toEqual({ cacheKey: "works:東京" });

    findUniqueMock.mockResolvedValueOnce({ list: JSON.stringify({ works: ["灌籃高手"] }) });
    expect(await listFamousWorks("鎌倉", "m")).toEqual(["灌籃高手"]);
    expect(createMock).toHaveBeenCalledTimes(1);

    createMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await listFamousWorks("大阪", "m")).toBeUndefined();
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });
});

describe("cleanTitles / filmNote", () => {
  it("keeps up to 3 distinct, trimmed titles", () => {
    expect(cleanTitles([" 你的名字 ", "你的名字", "", "灌籃高手", "鬼滅之刃", "孤獨的美食家"])).toEqual(["你的名字", "灌籃高手", "鬼滅之刃"]);
    expect(cleanTitles(undefined)).toEqual([]);
  });

  it("doesn't double the brackets", () => {
    expect(filmNote("《灌籃高手》")).toBe("《灌籃高手》據說曾在這裡取景，出發前可以查證");
  });
});

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
    seasonalHighlightCache: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
  },
}));
const textSearchMock = vi.fn();
vi.mock("@/lib/fetchCityRestaurants", () => ({
  searchTextCandidates: (...args: unknown[]) => textSearchMock(...args),
}));
const climateMock = vi.fn();
vi.mock("@/lib/climate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/climate")>()),
  getClimate: (...args: unknown[]) => climateMock(...args),
}));

const { findSeasonalDay, listSeasonalHighlights, nightHighlightEvent, pickHighlightMatch, seasonalDayIndex } = await import(
  "@/lib/seasonalHighlights"
);

const kyoto = { lat: 35.0116, lng: 135.7681 };
const place = (placeId: string, lat: number, lng: number, types: string[] = ["tourist_attraction"]): PlaceCandidate => ({
  name: placeId,
  placeId,
  lat,
  lng,
  address: "",
  types,
});
const tofukuji = place("東福寺", 34.9767, 135.7738, ["buddhist_temple", "tourist_attraction"]);
const arashiyama = place("嵐山", 35.0094, 135.6668);
const eikando = place("永觀堂", 35.0146, 135.7942);

const aiReturns = (json: unknown) =>
  createMock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(json) } }] });
const fall = {
  label: "賞楓",
  highlights: [
    { name: "東福寺", note: "通常在 11 月中下旬最美" },
    { name: "嵐山", note: "通常在 11 月下旬最美" },
    { name: "永觀堂", night: true, note: "秋季夜間點燈" },
  ],
};

beforeEach(() => {
  createMock.mockReset();
  findUniqueMock.mockReset();
  upsertMock.mockReset();
  textSearchMock.mockReset();
  climateMock.mockReset();
  findUniqueMock.mockResolvedValue(null);
});

describe("listSeasonalHighlights", () => {
  it("asks for places, not dated festivals, and caches the answer per city and month", async () => {
    aiReturns(fall);

    const list = await listSeasonalHighlights("京都", 11, "m");

    expect(list?.highlights.map((h) => h.name)).toEqual(["東福寺", "嵐山", "永觀堂"]);
    expect(list?.highlights[0].night).toBe(false); // defaults filled in
    const prompt = createMock.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("不列節慶或活動");
    expect(upsertMock.mock.calls[0][0].where).toEqual({ cacheKey: "京都|11" });
  });

  it("caches an empty month too, and serves the cache without asking again", async () => {
    aiReturns({ label: "", highlights: [] });
    await listSeasonalHighlights("大阪", 2, "m");
    expect(upsertMock).toHaveBeenCalled();

    findUniqueMock.mockResolvedValue({ list: JSON.stringify(fall) });
    expect((await listSeasonalHighlights("京都", 11, "m"))?.label).toBe("賞楓");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("keeps at most 4", async () => {
    aiReturns({ label: "賞櫻", highlights: Array.from({ length: 6 }, (_, i) => ({ name: `p${i}` })) });
    expect((await listSeasonalHighlights("東京", 4, "m"))?.highlights).toHaveLength(4);
  });

  it("doesn't cache a failed call", async () => {
    createMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await listSeasonalHighlights("京都", 11, "m")).toBeUndefined();
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe("pickHighlightMatch", () => {
  it("skips a hotel or restaurant named after the place, one far away, and one already used", () => {
    const hotel = place("嵐山 Hotel", 35.01, 135.67, ["lodging", "hotel"]);
    const elsewhere = place("嵐山 (北海道)", 43.0, 141.3);
    expect(pickHighlightMatch([hotel, elsewhere, arashiyama], kyoto, new Set())?.placeId).toBe("嵐山");
    expect(pickHighlightMatch([arashiyama], kyoto, new Set(["嵐山"]))).toBeUndefined();
  });
});

describe("findSeasonalDay", () => {
  const byName: Record<string, PlaceCandidate> = { 東福寺: tofukuji, 嵐山: arashiyama, 永觀堂: eikando };

  it("confirms each listed place with Text Search", async () => {
    aiReturns(fall);
    textSearchMock.mockImplementation(async (name: string) => [byName[name]]);

    const day = await findSeasonalDay("京都", kyoto, "key", "2026-11-20", "m", new Set());

    expect(day?.label).toBe("賞楓");
    expect(day?.highlights.map((h) => [h.place.placeId, h.night])).toEqual([
      ["東福寺", false],
      ["嵐山", false],
      ["永觀堂", true],
    ]);
    expect(textSearchMock.mock.calls[0].slice(0, 4)).toEqual(["東福寺", kyoto, "key", 30000]);
  });

  it("keeps one place for the evening and sends the rest by day", async () => {
    aiReturns({ label: "賞櫻", highlights: ["東福寺", "嵐山", "永觀堂"].map((name) => ({ name, night: true })) });
    textSearchMock.mockImplementation(async (name: string) => [byName[name]]);

    const day = await findSeasonalDay("京都", kyoto, "key", "2027-04-01", "m", new Set());

    expect(day?.highlights.map((h) => h.night)).toEqual([true, false, false]);
  });

  it("isn't a day's theme with fewer than 2 places found", async () => {
    aiReturns(fall);
    textSearchMock.mockImplementation(async (name: string) => (name === "東福寺" ? [tofukuji] : []));

    expect(await findSeasonalDay("京都", kyoto, "key", "2026-11-20", "m", new Set())).toBeUndefined();
  });

  it("drops a snow sight without last year's snow", async () => {
    aiReturns({ label: "雪景", highlights: [{ name: "東福寺", needsSnow: true }, { name: "嵐山" }, { name: "永觀堂" }] });
    textSearchMock.mockImplementation(async (name: string) => [byName[name]]);
    climateMock.mockResolvedValue({ avgMaxTempC: 9, avgSnowDepthM: 0 });

    const day = await findSeasonalDay("京都", kyoto, "key", "2027-01-10", "m", new Set());

    expect(day?.highlights.map((h) => h.place.placeId)).toEqual(["嵐山", "永觀堂"]);
    expect(textSearchMock).toHaveBeenCalledTimes(2);
  });

  it("titles the day 季節限定 when the model gave no label", async () => {
    aiReturns({ ...fall, label: " " });
    textSearchMock.mockImplementation(async (name: string) => [byName[name]]);

    expect((await findSeasonalDay("京都", kyoto, "key", "2026-11-20", "m", new Set()))?.label).toBe("季節限定");
  });
});

describe("nightHighlightEvent", () => {
  it("blocks the evening for an illumination, with its note", () => {
    const event = nightHighlightEvent({ place: eikando, night: true, note: "秋季夜間點燈" });
    expect(event.block).toEqual({ startMinute: 18 * 60 + 30, endMinute: 20 * 60 });
    expect(event.stop?.description).toBe("秋季夜間點燈");
    expect(event.stop?.copyPending).toBe(true);
  });
});

describe("seasonalDayIndex", () => {
  it("takes a day free of fixed events and the day trip, the arrival day last", () => {
    expect(seasonalDayIndex([0, 0, 0], 1)).toBe(2);
    expect(seasonalDayIndex([0, 1, 0], undefined)).toBe(2);
    expect(seasonalDayIndex([0, 1], undefined)).toBe(0);
    expect(seasonalDayIndex([1, 1], undefined)).toBeUndefined();
  });
});

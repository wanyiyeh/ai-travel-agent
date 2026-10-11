import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

const textMock = vi.fn();
vi.mock("@/lib/fetchCityRestaurants", () => ({
  searchTextCandidates: (...args: unknown[]) => textMock(...args),
}));

const { findPetFriendlyLodging, findPetFriendlyRestaurants, noPetLodging, takesDogs } = await import("@/lib/petFriendly");

const yilan = { lat: 24.7546, lng: 121.758 };
const place = (name: string, lat: number, lng: number): PlaceCandidate => ({ name, placeId: name, lat, lng, address: "" });

beforeEach(() => {
  textMock.mockReset();
});

describe("findPetFriendlyLodging", () => {
  it("searches 寵物友善住宿 as lodging, asking whether each takes dogs, and keeps those within 20km", async () => {
    textMock.mockResolvedValue([place("毛孩民宿", 24.78, 121.75), place("礁溪寵物旅店", 24.83, 121.77), place("台北寵物旅館", 25.05, 121.52)]);

    const found = await findPetFriendlyLodging(yilan, "key");

    expect(textMock.mock.calls[0]).toEqual(["寵物友善住宿", yilan, "key", 20000, "lodging", { tier: "pets" }]);
    expect(found.map((p) => p.name)).toEqual(["毛孩民宿", "礁溪寵物旅店"]);
  });

  it("keeps only stays that take dogs, by Google or by name", async () => {
    // As cached for 馬祖: none nearby take dogs, so ordinary guesthouses came back.
    textMock.mockResolvedValue([
      place("舒漫活海景旅宿", 24.76, 121.76),
      { ...place("靜隱花間", 24.76, 121.76), allowsDogs: true },
      { ...place("寵物島民宿", 24.76, 121.76), allowsDogs: false },
      place("宜蘭寵物友善民宿_柚紫緣", 24.76, 121.76),
    ]);

    const found = await findPetFriendlyLodging(yilan, "key");

    expect(found.map((p) => p.name)).toEqual(["靜隱花間", "宜蘭寵物友善民宿_柚紫緣"]);
  });

  it("finds nothing when the search fails", async () => {
    textMock.mockRejectedValue(new Error("HTTP 500"));
    expect(await findPetFriendlyLodging(yilan, "key")).toEqual([]);
  });
});

describe("findPetFriendlyRestaurants", () => {
  it("searches 寵物友善餐廳 at the meal tier, within 5km", async () => {
    textMock.mockResolvedValue([place("汪汪餐酒館", 24.76, 121.76), place("羅東狗狗餐廳", 24.68, 121.77)]);

    const found = await findPetFriendlyRestaurants(yilan, "key", "kids");

    expect(textMock.mock.calls[0]).toEqual(["寵物友善餐廳", yilan, "key", 5000, "restaurant", { tier: "kids" }]);
    expect(found.map((p) => p.name)).toEqual(["汪汪餐酒館"]); // 羅東 is ~8km away
  });
});

describe("noPetLodging", () => {
  it("suggests no stay, says why, and isn't looked up", () => {
    expect(noPetLodging("宜蘭")).toEqual({
      name: "",
      area: "宜蘭",
      reason: "這附近找不到寵物友善的住宿，請自行尋找可以帶狗的住宿",
      noneFound: true,
    });
  });
});

describe("takesDogs", () => {
  it("trusts Google's answer, else the name", () => {
    expect(takesDogs({ name: "Happy together 55 寵物友善民宿" })).toBe(true);
    expect(takesDogs({ name: "毛孩上課 | 寵物友善跑跑草皮" })).toBe(true);
    expect(takesDogs({ name: "舒漫活海景旅宿" })).toBe(false);
    expect(takesDogs({ name: "靜隱花間", allowsDogs: true })).toBe(true);
    expect(takesDogs({ name: "寵物島民宿", allowsDogs: false })).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

const textMock = vi.fn();
vi.mock("@/lib/fetchCityRestaurants", () => ({
  searchTextCandidates: (...args: unknown[]) => textMock(...args),
}));

const { findPetFriendlyLodging, findPetFriendlyRestaurants, noPetLodging } = await import("@/lib/petFriendly");

const yilan = { lat: 24.7546, lng: 121.758 };
const place = (name: string, lat: number, lng: number): PlaceCandidate => ({ name, placeId: name, lat, lng, address: "" });

beforeEach(() => {
  textMock.mockReset();
});

describe("findPetFriendlyLodging", () => {
  it("searches 寵物友善住宿 as lodging and keeps those within 10km", async () => {
    textMock.mockResolvedValue([place("毛孩民宿", 24.78, 121.75), place("礁溪寵物旅店", 24.83, 121.77), place("台北寵物旅館", 25.05, 121.52)]);

    const found = await findPetFriendlyLodging(yilan, "key");

    expect(textMock.mock.calls[0].slice(0, 5)).toEqual(["寵物友善住宿", yilan, "key", 10000, "lodging"]);
    expect(found.map((p) => p.name)).toEqual(["毛孩民宿", "礁溪寵物旅店"]);
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

const lodgingMock = vi.fn();
const petMock = vi.fn();
const hotSpringMock = vi.fn();
vi.mock("@/lib/fetchCityRestaurants", () => ({
  fetchLodgingCandidates: (...args: unknown[]) => lodgingMock(...args),
}));
vi.mock("@/lib/petFriendly", () => ({ findPetFriendlyLodging: (...args: unknown[]) => petMock(...args) }));
vi.mock("@/lib/domesticInterests", () => ({ findHotSpringLodging: (...args: unknown[]) => hotSpringMock(...args) }));

const { findSwapLodging, nearStationOrder, swapLodgingRulesOf } = await import("@/lib/swapLodging");

const center = { lat: 24.75, lng: 121.75 };
const stay = (name: string, types = ["hotel", "lodging"]): PlaceCandidate => ({ name, placeId: name, lat: 24.75, lng: 121.75, address: "", types });
const none = { pets: false, noHostels: false, solo: false, hotSpring: false };

beforeEach(() => {
  lodgingMock.mockReset().mockResolvedValue([stay("City Hotel"), stay("背包客棧", ["hostel", "lodging"])]);
  petMock.mockReset().mockResolvedValue([stay("毛孩民宿"), stay("礁溪溫泉寵物會館")]);
  hotSpringMock.mockReset().mockResolvedValue([stay("村却國際溫泉酒店")]);
});

describe("swapLodgingRulesOf", () => {
  it("reads the companions and 溫泉 from the trip's form", () => {
    expect(swapLodgingRulesOf({ companions: ["kids", "pets"], interests: ["hot_spring"] })).toEqual({
      pets: true,
      noHostels: true,
      solo: false,
      hotSpring: true,
    });
    expect(swapLodgingRulesOf(undefined)).toEqual(none);
  });
});

describe("findSwapLodging", () => {
  it("offers only stays that take dogs on a trip with one, a hot-spring one first", async () => {
    const found = await findSwapLodging(center, "key", undefined, { ...none, pets: true, hotSpring: true });
    expect(found.map((p) => p.name)).toEqual(["礁溪溫泉寵物會館", "毛孩民宿"]);
    expect(lodgingMock).not.toHaveBeenCalled();
  });

  it("leaves hostels out for children or older travelers", async () => {
    const found = await findSwapLodging(center, "key", "budget", { ...none, noHostels: true });
    expect(found.map((p) => p.name)).toEqual(["City Hotel"]);
  });

  it("puts hot-spring hotels first", async () => {
    const found = await findSwapLodging(center, "key", undefined, { ...none, hotSpring: true });
    expect(found.map((p) => p.name)).toEqual(["村却國際溫泉酒店", "City Hotel", "背包客棧"]);
  });
});

describe("nearStationOrder", () => {
  it("puts the closest to a station first, none found last", () => {
    const order = nearStationOrder([
      { name: "far", nearestStation: { name: "A", distanceMeters: 900 } },
      { name: "none", nearestStation: null },
      { name: "near", nearestStation: { name: "B", distanceMeters: 150 } },
    ]);
    expect(order.map((c) => c.name)).toEqual(["near", "far", "none"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

const nearbyMock = vi.fn();
vi.mock("@/lib/fetchCityRestaurants", () => ({
  fetchNearbyPlaceCandidates: (...args: unknown[]) => nearbyMock(...args),
}));

const { findIslandDayTrip, islandDayTripOptions, islandTripEvents } = await import("@/lib/islandDayTrips");

const sight = (name: string): PlaceCandidate => ({ name, placeId: name, lat: 26.22, lng: 119.99, address: "" });

beforeEach(() => {
  nearbyMock.mockReset();
});

describe("islandDayTripOptions", () => {
  it("goes from the main island, a day to 北竿 or 莒光 — not 東引, two hours each way", () => {
    expect(islandDayTripOptions("馬祖", "day").map((i) => i.name)).toEqual(["北竿", "莒光"]);
  });

  it("keeps a half day to the short, frequent crossings", () => {
    expect(islandDayTripOptions("馬祖", "half").map((i) => i.name)).toEqual(["北竿"]);
    expect(islandDayTripOptions("澎湖", "half").map((i) => i.name)).toEqual(["吉貝", "桶盤", "虎井"]);
  });

  it("has none from a neighbouring island or off the groups", () => {
    expect(islandDayTripOptions("北竿", "day")).toEqual([]);
    expect(islandDayTripOptions("綠島", "day")).toEqual([]);
  });
});

describe("findIslandDayTrip", () => {
  it("takes the first island with enough sights not on the trip yet, searched from that island", async () => {
    nearbyMock.mockResolvedValue([sight("芹壁聚落"), sight("北竿戰爭和平紀念公園"), sight("壁山觀景台")]);

    const trip = await findIslandDayTrip("馬祖", "key", "day", new Set(["壁山觀景台"]));

    expect(trip?.island.name).toBe("北竿");
    expect(trip?.sights.map((s) => s.name)).toEqual(["芹壁聚落", "北竿戰爭和平紀念公園"]);
    expect(nearbyMock.mock.calls[0][0]).toEqual({ lat: 26.2215, lng: 119.9902 });
  });
});

describe("islandTripEvents", () => {
  it("says the boat over and back, as estimates", () => {
    const events = islandTripEvents(
      { island: { name: "北竿", center: { lat: 0, lng: 0 }, ferry: { port: "南竿福澳港", minutes: 20, frequent: true } }, sights: [sight("芹壁聚落"), sight("壁山觀景台")] },
      "南竿",
      "day",
      9 * 60,
      18 * 60
    );
    expect(events[0].stop?.description).toBe("坐船一日遊：從南竿福澳港搭船約 20 分到北竿（估計，出發前確認船班，會依季節和海象調整）");
    expect(events.at(-1)?.stop?.description).toBe("傍晚搭船回南竿");
  });

  it("drives to 赤崁 first for 吉貝, and is back after lunch on a half day", () => {
    const jibei = { name: "吉貝", center: { lat: 0, lng: 0 }, ferry: { port: "白沙赤崁碼頭", minutes: 20, frequent: true, landMinutes: 30 } };
    const events = islandTripEvents({ island: jibei, sights: [sight("吉貝沙尾")] }, "澎湖", "half", 9 * 60, 18 * 60);
    expect(events[0].stop?.description).toContain("開車或搭車約 30 分到白沙赤崁碼頭，搭船約 20 分到吉貝");
    expect(events[0].stop?.description).toContain("中午過後搭船回澎湖");
    expect(events.at(-1)?.block.endMinute).toBe(14 * 60);
  });
});

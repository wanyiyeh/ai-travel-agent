import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";

const nearbyMock = vi.fn();
const textMock = vi.fn();
vi.mock("@/lib/fetchCityRestaurants", () => ({
  fetchNearbyPlaceCandidates: (...args: unknown[]) => nearbyMock(...args),
  searchTextCandidates: (...args: unknown[]) => textMock(...args),
}));

const {
  campsiteStay,
  findCampsite,
  findHotSpringLodging,
  findHotSpringSoak,
  findNightMarkets,
  hotSpringSoakEvent,
  isHotSpringStay,
  nightMarketDays,
  nightMarketDinner,
} = await import("@/lib/domesticInterests");

const tainan = { lat: 22.9971, lng: 120.2127 };
const place = (name: string, lat: number, lng: number, types: string[] = ["tourist_attraction"]): PlaceCandidate => ({
  name,
  placeId: name,
  lat,
  lng,
  address: "",
  types,
});

beforeEach(() => {
  nearbyMock.mockReset();
  textMock.mockReset();
});

describe("nightMarketDays", () => {
  it("gives one evening, two from three nights, the last first", () => {
    expect(nightMarketDays(0)).toEqual([]);
    expect(nightMarketDays(1)).toEqual([0]);
    expect(nightMarketDays(2)).toEqual([1]);
    expect(nightMarketDays(3)).toEqual([0, 2]);
  });
});

describe("findNightMarkets", () => {
  it("takes night markets near the city, not used yet, by name", async () => {
    textMock.mockResolvedValue([
      place("花園夜市", 23.011, 120.199),
      place("赤崁樓", 22.997, 120.202), // the search can return other sights
      place("大東夜市", 22.985, 120.222),
      place("六合夜市", 22.632, 120.301), // 高雄, too far
    ]);

    const markets = await findNightMarkets(tainan, "key", 2, new Set(["花園夜市"]));

    expect(textMock.mock.calls[0].slice(0, 4)).toEqual(["夜市", tainan, "key", 15000]);
    expect(markets.map((m) => m.name)).toEqual(["大東夜市"]);
  });

  it("makes no search for no evenings", async () => {
    expect(await findNightMarkets(tainan, "key", 0, new Set())).toEqual([]);
    expect(textMock).not.toHaveBeenCalled();
  });
});

describe("nightMarketDinner", () => {
  it("is dinner with a note to check its days, and a line still to write", () => {
    const dinner = nightMarketDinner(place("大東夜市", 22.985, 120.222));
    expect(dinner).toMatchObject({ name: "大東夜市", placeId: "大東夜市", copyPending: true });
    expect(dinner.description).toContain("出發前確認");
  });
});

describe("hot springs", () => {
  it("looks for hot-spring hotels as lodging, out to 20km", async () => {
    textMock.mockResolvedValue([place("北投老爺酒店", 25.137, 121.507, ["hotel", "lodging"]), place("Far Spa Hotel", 24.3, 121.5, ["hotel"])]);

    const found = await findHotSpringLodging({ lat: 25.0478, lng: 121.517 }, "key");

    expect(textMock.mock.calls[0]).toEqual(["溫泉飯店", { lat: 25.0478, lng: 121.517 }, "key", 20000, "lodging"]);
    expect(found.map((p) => p.name)).toEqual(["北投老爺酒店"]);
  });

  it("knows a hot-spring stay by its name", () => {
    expect(isHotSpringStay("礁溪老爺酒店溫泉")).toBe(true);
    expect(isHotSpringStay("湯守閣")).toBe(true);
    expect(isHotSpringStay("台南遠東香格里拉")).toBe(false);
    expect(isHotSpringStay(undefined)).toBe(false);
  });

  it("finds a public bath to soak at, not a hotel", async () => {
    textMock.mockResolvedValue([
      place("溫泉酒店", 23.0, 120.21, ["hotel", "lodging"]),
      place("關子嶺溫泉公共浴池", 23.33, 120.5, ["public_bath"]), // ~45km: past a soak's reach
      place("城裡的湯屋", 23.02, 120.23, ["public_bath"]),
    ]);

    expect((await findHotSpringSoak(tainan, "key", new Set()))?.name).toBe("城裡的湯屋");
  });

  it("blocks the early evening for the soak", () => {
    const event = hotSpringSoakEvent(place("關子嶺溫泉公共浴池", 23.33, 120.5));
    expect(event.block).toEqual({ startMinute: 17 * 60, endMinute: 18 * 60 + 30 });
    expect(event.stop?.description).toBe("傍晚泡湯");
  });
});

describe("camping", () => {
  it("takes Google's campground type first, within 40km", async () => {
    nearbyMock.mockResolvedValue([
      place("Far Camp", 24.0, 120.9, ["campground"]),
      { ...place("梅峰露營區", 23.2, 120.4, ["campground"]), address: "台灣台南市楠西區" },
    ]);

    const site = await findCampsite(tainan, "key", "台南");

    expect(nearbyMock.mock.calls[0].slice(2, 6)).toEqual([["campground"], 40000, 20, "pro"]);
    expect(site?.name).toBe("梅峰露營區");
    expect(textMock).not.toHaveBeenCalled();
  });

  it("falls back to a text search", async () => {
    nearbyMock.mockResolvedValue([]);
    textMock.mockResolvedValue([place("山上露營區", 23.1, 120.3)]);

    expect((await findCampsite(tainan, "key", "台南"))?.name).toBe("山上露營區"); // ~13km, close enough
    expect(textMock.mock.calls[0][0]).toBe("露營區");
  });

  it("prefers a site in the city's own county over a closer one over the mountains", async () => {
    const { pickCampsite } = await import("@/lib/domesticInterests");
    const yilan = { lat: 24.7546, lng: 121.758 };
    // as cached for 宜蘭: 三峽 is over the 雪山 range
    const sanxia = { ...place("皇后鎮森林三峽", 24.86, 121.42), address: "237台灣新北市三峽區竹崙里竹崙路95巷1號" };
    const yuanshan = { ...place("覽陽洋露營區", 24.74, 121.6), address: "之1, No. 537號, 隘界2路, 員山鄉宜蘭縣台灣 264" };
    expect(pickCampsite([sanxia, yuanshan], yilan, "宜蘭")?.name).toBe("覽陽洋露營區");
    expect(pickCampsite([sanxia], yilan, "宜蘭")).toBeUndefined(); // 36km away and not in 宜蘭
  });

  it("is that night's lodging, with what to bring", () => {
    const stay = campsiteStay(place("梅峰露營區", 23.2, 120.4), "台南");
    expect(stay).toMatchObject({ name: "梅峰露營區", area: "台南", placeId: "梅峰露營區" });
    expect(stay.reason).toContain("自備或租借帳篷");
  });
});

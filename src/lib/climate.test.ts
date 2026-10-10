import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const upsertMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    climateNormalCache: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
  },
}));

const { climateMonth, getClimate, isInSeason, meetsNeed, parseClimate, seasonalNeed } = await import("@/lib/climate");

// 札幌國際滑雪場, probed: 11月 2025 had 0.06m of snow on average, 12月 0.53m.
const kokusai = { lat: 43.08, lng: 141.1 };
const archive = (highs: number[], snow: number[], rain: number[] = [0, 0], sunset = ["2025-11-01T16:24", "2025-11-30T16:02"]) => ({
  daily: { temperature_2m_max: highs, precipitation_sum: rain, sunset },
  hourly: { snow_depth: snow },
});
// The rain and sunset don't matter to the season rules.
const weather = (avgMaxTempC: number, avgSnowDepthM: number) => ({
  avgMaxTempC,
  avgSnowDepthM,
  rainyDayShare: 0,
  sunsetFirstMinute: 1000,
  sunsetLastMinute: 1000,
});

describe("climateMonth", () => {
  it("looks at the same month last year", () => {
    expect(climateMonth("2026-11-10")).toBe("2025-11");
    expect(climateMonth("2027-01-03")).toBe("2026-01");
  });
});

describe("parseClimate", () => {
  it("averages the daily highs and the snow depth, skipping gaps", () => {
    const climate = parseClimate(archive([2, 4, null as unknown as number], [0.4, 0.6]));
    expect(climate).toMatchObject({ avgMaxTempC: 3, avgSnowDepthM: 0.5 });
  });

  it("counts the days with any rain, and reads the first and last sunset", () => {
    // 東京 6月 2025: 18 of 30 days had 0.1mm+, only 13 had 1mm+
    const rain = [...Array(13).fill(5), ...Array(5).fill(0.3), ...Array(12).fill(0)];
    const climate = parseClimate(archive([27], [0], rain, ["2025-06-01T18:51", "2025-06-30T19:00"]));
    expect(climate?.rainyDayShare).toBeCloseTo(18 / 30);
    expect(climate?.sunsetFirstMinute).toBe(18 * 60 + 51);
    expect(climate?.sunsetLastMinute).toBe(19 * 60);
  });

  it("has nothing to say without data", () => {
    expect(parseClimate({ error: true, reason: "out of range" })).toBeUndefined();
  });
});

describe("seasonalNeed / meetsNeed", () => {
  it("asks a ski resort for snow and a beach or water park for warmth", () => {
    expect(seasonalNeed(["ski_resort", "tourist_attraction"])).toBe("snow");
    expect(seasonalNeed(["beach"])).toBe("warmth");
    expect(seasonalNeed(["water_park"])).toBe("warmth");
    expect(seasonalNeed(["national_park", "hiking_area"])).toBeUndefined();
  });

  it("keeps a marina or fishing trip to days that aren't cold", () => {
    expect(seasonalNeed(["marina"])).toBe("mild");
    expect(seasonalNeed(["fishing_charter"])).toBe("mild");
    expect(meetsNeed("mild", weather(3.6, 0.03))).toBe(false); // 札幌 11月
    expect(meetsNeed("mild", weather(16.8, 0))).toBe(true); // 湘南 11月
  });

  it("wants 0.3m of snow on the ground", () => {
    expect(meetsNeed("snow", weather(3.3, 0.06))).toBe(false); // 札幌 11月
    expect(meetsNeed("snow", weather(-2.5, 0.53))).toBe(true); // 札幌 12月
  });

  it("wants a 25°C high for the beach", () => {
    expect(meetsNeed("warmth", weather(16.8, 0))).toBe(false); // 湘南 11月
    expect(meetsNeed("warmth", weather(32.8, 0))).toBe(true); // 湘南 8月
  });

  it("doesn't send anyone to a seasonal place when the weather is unknown", () => {
    expect(meetsNeed("snow", undefined)).toBe(false);
  });
});

describe("getClimate", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("CLIMATE_LOOKUPS", "");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    findUniqueMock.mockReset();
    upsertMock.mockReset();
    findUniqueMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks Open-Meteo for last year's month at the place, and caches it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(archive([3, 3.6], [0.05, 0.07]))));

    const climate = await getClimate(kokusai.lat, kokusai.lng, "2026-11-10");

    expect(climate?.avgSnowDepthM).toBeCloseTo(0.06);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("archive-api.open-meteo.com");
    expect(url).toContain("latitude=43.1&longitude=141.1");
    expect(url).toContain("start_date=2025-11-01&end_date=2025-11-30");
    expect(upsertMock.mock.calls[0][0].where).toEqual({ cacheKey: "43.1,141.1,2025-11" });
  });

  it("asks for the rain and the sunset too", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(archive([3], [0]))));

    await getClimate(kokusai.lat, kokusai.lng, "2026-11-10");

    expect(String(fetchMock.mock.calls[0][0])).toContain("daily=temperature_2m_max,precipitation_sum,sunset");
  });

  it("uses the cache without asking again", async () => {
    findUniqueMock.mockResolvedValue(weather(-2.5, 0.53));

    expect(await getClimate(kokusai.lat, kokusai.lng, "2026-12-20")).toEqual(weather(-2.5, 0.53));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fills in a cached row from before rain and sunset were kept", async () => {
    findUniqueMock.mockResolvedValue({ avgMaxTempC: 3.6, avgSnowDepthM: 0.03, rainyDayShare: null, sunsetFirstMinute: null, sunsetLastMinute: null });
    fetchMock.mockResolvedValue(new Response(JSON.stringify(archive([3.6], [0.03]))));

    expect((await getClimate(kokusai.lat, kokusai.lng, "2026-11-10"))?.sunsetFirstMinute).toBe(16 * 60 + 24);
    expect(upsertMock).toHaveBeenCalled();
  });

  it("doesn't cache a failed request, so it retries next time", async () => {
    fetchMock.mockResolvedValue(new Response("busy", { status: 429 }));

    expect(await getClimate(kokusai.lat, kokusai.lng, "2026-11-10")).toBeUndefined();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("treats a broken cache as unknown weather, not a failed trip", async () => {
    // a dev.db without the table once sank a whole generation
    findUniqueMock.mockRejectedValue(new Error("The table `main.ClimateNormalCache` does not exist"));

    expect(await getClimate(kokusai.lat, kokusai.lng, "2026-11-10")).toBeUndefined();
  });

  it("stays off in tests", async () => {
    vi.stubEnv("CLIMATE_LOOKUPS", "off");

    expect(await getClimate(kokusai.lat, kokusai.lng, "2026-11-10")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("fakes the weather in mock mode", async () => {
    vi.stubEnv("MOCK_PLACES", "1");

    expect(await getClimate(kokusai.lat, kokusai.lng, "2026-08-10")).toMatchObject({ avgMaxTempC: 31, avgSnowDepthM: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("isInSeason", () => {
  beforeEach(() => {
    vi.stubEnv("CLIMATE_LOOKUPS", "");
    findUniqueMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("checks the weather only for seasonal places", async () => {
    expect(await isInSeason({ ...kokusai, types: ["national_park"] }, "2026-11-10")).toBe(true);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("skips a ski resort without snow", async () => {
    findUniqueMock.mockResolvedValue(weather(3.3, 0.06));
    expect(await isInSeason({ ...kokusai, types: ["ski_resort"] }, "2026-11-10")).toBe(false);
  });
});

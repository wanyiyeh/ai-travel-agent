import { prisma } from "@/lib/db";
import { isMockPlaces } from "@/lib/mockPlaces";

// 季節過濾 (plan/form-preference-wiring.md 1.12, phase 3c-1): whether a
// beach or a ski resort makes sense on the trip's dates, judged from last
// year's weather for the same month at the place itself — month and
// latitude alone can't tell 11月 札幌 (no snow on the slopes yet) from 12月.
//
// Open-Meteo's historical weather API: free and keyless, but the free plan
// is for non-commercial use only — fine for a portfolio project, a paid plan
// before this goes commercial. Not a Google service, so it doesn't go through
// googleFetch: MOCK_PLACES fakes it here, and tests turn it off with
// CLIMATE_LOOKUPS=off (no key to blank, unlike Google and OpenAI).
//
// 3c-4 adds what each day's schedule needs (dayConditions.ts): how often it
// rains that month and when the sun sets.

export type Climate = {
  /** Mean of the daily high, °C. */
  avgMaxTempC: number;
  /** Mean snow depth on the ground, meters. */
  avgSnowDepthM: number;
  /** Share of days with any measurable rain (0.1mm+). */
  rainyDayShare: number;
  /** Local sunset on the month's first and last day, minutes since midnight. */
  sunsetFirstMinute: number;
  sunsetLastMinute: number;
};

/** Last year's month for a trip date: "2026-11-10" → "2025-11". */
export function climateMonth(tripDate: string): string {
  const [year, month] = tripDate.split("-");
  return `${Number(year) - 1}-${month}`;
}

function monthRange(month: string): { start: string; end: string } {
  const [year, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

const avg = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => typeof v === "number");
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : undefined;
};

// Any measurable rain. At 1mm, 東京's 6月 (梅雨) had rain on 11-16 of 30
// days in 2023-2025 — under half — but 18-21 at 0.1mm; 11月 has 10.
const RAIN_MM = 0.1;

// "2025-06-01T18:51" (local time, timezone=auto) → 1131.
const minuteOfIso = (iso: string | null | undefined) => {
  const match = iso ? /T(\d{2}):(\d{2})/.exec(iso) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
};

type ArchiveResponse = {
  daily?: { temperature_2m_max?: (number | null)[]; precipitation_sum?: (number | null)[]; sunset?: (string | null)[] };
  hourly?: { snow_depth?: (number | null)[] };
};

/** The Open-Meteo archive response, reduced to a Climate; undefined when the data is missing. */
export function parseClimate(json: unknown): Climate | undefined {
  const data = json as ArchiveResponse;
  const avgMaxTempC = avg(data.daily?.temperature_2m_max ?? []);
  const avgSnowDepthM = avg(data.hourly?.snow_depth ?? []);
  const rain = (data.daily?.precipitation_sum ?? []).filter((v): v is number => typeof v === "number");
  const sunsets = data.daily?.sunset ?? [];
  const sunsetFirstMinute = minuteOfIso(sunsets[0]);
  const sunsetLastMinute = minuteOfIso(sunsets[sunsets.length - 1]);
  if (
    avgMaxTempC === undefined ||
    avgSnowDepthM === undefined ||
    rain.length === 0 ||
    sunsetFirstMinute === undefined ||
    sunsetLastMinute === undefined
  ) {
    return undefined;
  }
  const rainyDayShare = rain.filter((mm) => mm >= RAIN_MM).length / rain.length;
  return { avgMaxTempC, avgSnowDepthM, rainyDayShare, sunsetFirstMinute, sunsetLastMinute };
}

// Summer warm, winter snowy and dark early, the rest mild — enough to click through dev:mock.
function mockClimate(month: string): Climate {
  const m = Number(month.slice(5));
  if (m >= 6 && m <= 9) return { avgMaxTempC: 31, avgSnowDepthM: 0, rainyDayShare: 0.6, sunsetFirstMinute: 1140, sunsetLastMinute: 1140 };
  if (m === 12 || m <= 3) return { avgMaxTempC: 0, avgSnowDepthM: 0.5, rainyDayShare: 0.3, sunsetFirstMinute: 990, sunsetLastMinute: 990 };
  return { avgMaxTempC: 18, avgSnowDepthM: 0, rainyDayShare: 0.3, sunsetFirstMinute: 1050, sunsetLastMinute: 1050 };
}

// Places a tenth of a degree apart (~10km) share a cache row.
const round = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

/**
 * Last year's weather for the trip date's month at a place, cached per
 * place and month. Undefined when lookups are off or anything fails — the
 * request or the cache (a missing table once sank a whole generation) —
 * and a failure isn't cached, so it retries next time.
 */
export async function getClimate(lat: number, lng: number, tripDate: string): Promise<Climate | undefined> {
  if (process.env.CLIMATE_LOOKUPS === "off") return undefined;
  const month = climateMonth(tripDate);
  if (isMockPlaces()) return mockClimate(month);

  const cacheKey = `${round(lat)},${round(lng)},${month}`;
  const { start, end } = monthRange(month);
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${round(lat)}&longitude=${round(lng)}` +
    `&start_date=${start}&end_date=${end}&daily=temperature_2m_max,precipitation_sum,sunset&hourly=snow_depth&timezone=auto`;
  try {
    const cached = await prisma.climateNormalCache.findUnique({ where: { cacheKey } });
    // Rows from before 3c-4 have no rain or sunset yet: fetched again and filled in.
    if (cached && cached.rainyDayShare !== null && cached.sunsetFirstMinute !== null && cached.sunsetLastMinute !== null) {
      return {
        avgMaxTempC: cached.avgMaxTempC,
        avgSnowDepthM: cached.avgSnowDepthM,
        rainyDayShare: cached.rainyDayShare,
        sunsetFirstMinute: cached.sunsetFirstMinute,
        sunsetLastMinute: cached.sunsetLastMinute,
      };
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[climate] ${cacheKey}: HTTP ${res.status}`);
      return undefined;
    }
    const climate = parseClimate(await res.json());
    if (!climate) return undefined;
    await prisma.climateNormalCache.upsert({
      where: { cacheKey },
      create: { cacheKey, ...climate },
      update: climate,
    });
    return climate;
  } catch (err) {
    console.warn(`[climate] ${cacheKey}: lookup failed`, err);
    return undefined;
  }
}

// A beach day wants a warm day (a 25°C high is about when people swim); a
// marina or a fishing trip just not a cold one — a whole day at 札幌's
// harbor in 11月 (a 3.6°C high) isn't a day out; a ski resort wants snow on
// the ground. Probed for 札幌國際滑雪場: 0.06m average in 11月 2025, 0.53m in 12月.
const WARM_ENOUGH_C = 25;
const MILD_ENOUGH_C = 15;
const SNOW_ENOUGH_M = 0.3;
const NEEDS_SNOW = ["ski_resort"];
const NEEDS_WARMTH = ["beach", "water_park"];
const NEEDS_MILD = ["marina", "fishing_charter"];
export type SeasonalNeed = "snow" | "warmth" | "mild";

/** What season a place's type needs, if any. */
export function seasonalNeed(types: string[] | undefined): SeasonalNeed | undefined {
  if (types?.some((t) => NEEDS_SNOW.includes(t))) return "snow";
  if (types?.some((t) => NEEDS_WARMTH.includes(t))) return "warmth";
  if (types?.some((t) => NEEDS_MILD.includes(t))) return "mild";
  return undefined;
}

/** Whether the climate meets the need. Unknown weather doesn't: better to skip a ski resort than send someone to bare slopes. */
export function meetsNeed(need: SeasonalNeed, climate: Climate | undefined): boolean {
  if (!climate) return false;
  if (need === "snow") return climate.avgSnowDepthM >= SNOW_ENOUGH_M;
  return climate.avgMaxTempC >= (need === "warmth" ? WARM_ENOUGH_C : MILD_ENOUGH_C);
}

/** Whether a place is in season on a trip date: anything without a seasonal type is. */
export async function isInSeason(
  place: { lat: number; lng: number; types?: string[] },
  tripDate: string
): Promise<boolean> {
  const need = seasonalNeed(place.types);
  if (!need) return true;
  return meetsNeed(need, await getClimate(place.lat, place.lng, tripDate));
}

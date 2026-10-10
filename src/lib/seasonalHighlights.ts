import { z } from "zod";
import { COPY_PENDING } from "@/lib/copyPending";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { searchTextCandidates, type PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { haversineKm } from "@/lib/geo";
import { getClimate, meetsNeed } from "@/lib/climate";
import type { DayFixedEvents } from "@/lib/fixedEvents";

// 季節亮點 (plan/form-preference-wiring.md 1.12, phase 3c-2): one day per
// city built around what that city is known for in that month every year —
// 11月 京都's foliage, 4月 東京's cherry blossoms, winter illuminations.
// Dated festivals are left out: their dates move from year to year and the
// model gets them wrong. The model lists the places, Text Search confirms
// each exists near the city, and a snow sight needs last year's snow
// (climate.ts) — the model would happily send someone to see snow in Tokyo.

const HighlightListSchema = z.object({
  /** Short day title, e.g. 「賞楓」. */
  label: z.string().default(""),
  highlights: z
    .array(
      z.object({
        /** The place's own name, as a map search would find it. */
        name: z.string().min(1),
        /** Best after dark (an illumination). */
        night: z.boolean().default(false),
        /** Only worth it with snow on the ground. */
        needsSnow: z.boolean().default(false),
        /** A cautious word on timing: 「通常在 11 月中下旬最美」. */
        note: z.string().default(""),
      })
    )
    .default([]),
});
export type HighlightList = z.infer<typeof HighlightListSchema>;

const MAX_LISTED = 4;

function systemPrompt(city: string, month: number): string {
  return `你是旅遊規劃專家。請列出「${city}」在 ${month} 月最值得去的季節限定景點：每年這個月固定會有、
其他月份看不到或沒那麼好看的，例如賞楓、賞櫻、花海、雪景、冬季點燈。

規則：
- 只列「地點」，不列節慶或活動（祭典、煙火大會、市集）：活動日期每年不同
- 地點要在 ${city} 市區或 30 km 內，寫地圖上搜得到的正式名稱
- 最多 ${MAX_LISTED} 個；這個月沒有明顯的季節亮點就回傳空陣列，不要硬湊
- note 寫一句保守的時機說明，例如「通常在 11 月中下旬最美，出發前可以查今年的狀況」，
  不要寫成今年一定會怎樣
- night：只有主要看點是晚上點燈的地點（例如冬季點燈）才填 true。賞櫻、賞楓的名所白天就值得去，
  即使有夜櫻、夜楓點燈也填 false
- needsSnow：要有積雪才值得去的地點填 true

回傳嚴格的 JSON（不要其他文字）：
{
  "label": "這一天的主題，2～4 個字，例如「賞楓」",
  "highlights": [{ "name": "地點名稱", "night": false, "needsSnow": false, "note": "時機說明" }]
}`;
}

/**
 * The model's seasonal places for a city and month, cached per city and
 * month — an empty list too, since "nothing special this month" is an
 * answer. A failed call isn't cached, so it retries next time.
 */
export async function listSeasonalHighlights(city: string, month: number, model: string): Promise<HighlightList | undefined> {
  const cacheKey = `${city}|${month}`;
  try {
    const cached = await prisma.seasonalHighlightCache.findUnique({ where: { cacheKey } });
    if (cached) return HighlightListSchema.parse(JSON.parse(cached.list));

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt(city, month) },
        { role: "user", content: `${city}，${month} 月` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    const content = completion.choices[0].message.content;
    if (!content) return undefined;
    const parsed = HighlightListSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      console.warn(`[seasonalHighlights] ${cacheKey}: schema mismatch`, content);
      return undefined;
    }
    const list = { ...parsed.data, highlights: parsed.data.highlights.slice(0, MAX_LISTED) };
    await prisma.seasonalHighlightCache.upsert({
      where: { cacheKey },
      create: { cacheKey, list: JSON.stringify(list) },
      update: { list: JSON.stringify(list) },
    });
    return list;
  } catch (err) {
    console.warn(`[seasonalHighlights] ${cacheKey}: failed`, err);
    return undefined;
  }
}

export type SeasonalHighlight = { place: PlaceCandidate; night: boolean; note: string };
export type SeasonalDay = { label: string; highlights: SeasonalHighlight[] };

// The prompt asks for 30km; a match further out is a same-named place elsewhere.
const MAX_HIGHLIGHT_KM = 30;
// A search for a foliage spot can land on a hotel or restaurant named after it.
const NOT_A_SIGHT = ["lodging", "hotel", "restaurant", "food", "cafe", "bar", "store", "meal_takeaway"];
// Fewer than this and it's not a day's theme.
const MIN_HIGHLIGHTS = 2;

/** The search result that is really the listed place: a sight, near the city, not used yet. */
export function pickHighlightMatch(
  candidates: PlaceCandidate[],
  center: { lat: number; lng: number },
  usedPlaceIds: Set<string>
): PlaceCandidate | undefined {
  return candidates.find(
    (c) =>
      !usedPlaceIds.has(c.placeId) &&
      !c.types?.some((t) => NOT_A_SIGHT.includes(t)) &&
      haversineKm(center.lat, center.lng, c.lat, c.lng) <= MAX_HIGHLIGHT_KM
  );
}

/**
 * A city's seasonal day for a trip date: the listed places that Text Search
 * confirms (each a cached Pro request), a snow sight only with last year's
 * snow. Undefined with fewer than MIN_HIGHLIGHTS.
 */
export async function findSeasonalDay(
  city: string,
  center: { lat: number; lng: number },
  apiKey: string,
  tripDate: string,
  model: string,
  usedPlaceIds: Set<string>
): Promise<SeasonalDay | undefined> {
  const list = await listSeasonalHighlights(city, Number(tripDate.slice(5, 7)), model);
  if (!list || list.highlights.length < MIN_HIGHLIGHTS) return undefined;

  const snowy = list.highlights.some((h) => h.needsSnow)
    ? meetsNeed("snow", await getClimate(center.lat, center.lng, tripDate))
    : false;
  const wanted = list.highlights.filter((h) => !h.needsSnow || snowy);
  const matches = await Promise.all(
    wanted.map((h) => searchTextCandidates(h.name, center, apiKey, MAX_HIGHLIGHT_KM * 1000).catch(() => [] as PlaceCandidate[]))
  );

  // One evening per day: a spring list came back all night (夜櫻), and four
  // places were booked for the same 18:30 slot while the daytime filled with
  // unrelated sights. The rest are worth seeing by day anyway.
  const taken = new Set(usedPlaceIds);
  const highlights: SeasonalHighlight[] = [];
  wanted.forEach((h, i) => {
    const place = pickHighlightMatch(matches[i], center, taken);
    if (!place) return;
    taken.add(place.placeId);
    highlights.push({ place, night: h.night && !highlights.some((x) => x.night), note: h.note });
  });
  return highlights.length >= MIN_HIGHLIGHTS ? { label: list.label.trim() || "季節限定", highlights } : undefined;
}

// An illumination after dinner time's start, before the last trains.
const NIGHT_START_MINUTE = 18 * 60 + 30;
const NIGHT_MINUTES = 90;

/** A night highlight as an evening block, like a booked show. */
export function nightHighlightEvent(h: SeasonalHighlight): DayFixedEvents[number] {
  return {
    block: { startMinute: NIGHT_START_MINUTE, endMinute: NIGHT_START_MINUTE + NIGHT_MINUTES },
    stop: {
      id: crypto.randomUUID(),
      placeId: h.place.placeId,
      name: h.place.name,
      description: h.note || "晚上點燈後最美",
      [COPY_PENDING]: true,
      duration_minutes: NIGHT_MINUTES,
      time_of_day: "evening",
      lat: h.place.lat,
      lng: h.place.lng,
      address: h.place.address,
      rating: h.place.rating ?? null,
      photoName: h.place.photoName ?? null,
    },
  };
}

/**
 * Which of a city's sightseeing days a themed day (seasonal, film) takes:
 * free of fixed events and of `taken` days (the day trip, another theme),
 * the arrival day last.
 */
export function seasonalDayIndex(dayEventCounts: number[], taken: number | undefined | (number | undefined)[]): number | undefined {
  const takenDays = Array.isArray(taken) ? taken : [taken];
  const free = dayEventCounts.map((n, i) => i).filter((i) => dayEventCounts[i] === 0 && !takenDays.includes(i));
  return free.find((i) => i > 0) ?? free[0];
}

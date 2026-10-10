import { z } from "zod";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { searchTextCandidates, type PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { pickHighlightMatch } from "@/lib/seasonalHighlights";
import { haversineKm } from "@/lib/geo";

// 影劇追星 (plan/form-preference-wiring.md 1.3, phase 4): one day per city at
// places films and series were shot.
//
// Google finds the places, not the model. Asked for 《你的名字》's locations,
// gpt-4o-mini listed the fictional 「三葉神社」, then the Ghibli Museum and
// 秋葉原 — real places, unrelated to the film. A Text Search for 「你的名字
// 聖地巡禮」 put 須賀神社 (the stairs) first, and 「灌籃高手 聖地巡禮」 the
// 鎌倉高校前 crossing; past the first few, results drift into nearby sights.
// So each work gets one search and only its top results. The model only
// names the works, when the traveler didn't: titles it knows far better
// than where they were shot. We still can't confirm a scene, so the note
// says 「據說」.

export const MAX_TITLES = 3;

/** Titles as typed: trimmed, deduplicated, at most MAX_TITLES. */
export function cleanTitles(titles: string[] | undefined): string[] {
  return [...new Set((titles ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, MAX_TITLES);
}

const WorksSchema = z.object({ works: z.array(z.string().min(1)).default([]) });

/**
 * The city's best-known filmed works, for a traveler who chose 影劇追星
 * without naming any — cached per city (an empty list too); a failed call
 * isn't cached.
 */
export async function listFamousWorks(city: string, model: string): Promise<string[] | undefined> {
  const cacheKey = `works:${city}`;
  try {
    const cached = await prisma.filmLocationCache.findUnique({ where: { cacheKey } });
    if (cached) return WorksSchema.parse(JSON.parse(cached.list)).works;

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `請列出在「${city}」取景、最有名、最多人去朝聖的電影、影集或動畫，最多 ${MAX_TITLES} 部，寫中文作品名稱。
沒有的話回傳空陣列。回傳嚴格的 JSON（不要其他文字）：{ "works": ["作品名稱"] }`,
        },
        { role: "user", content: city },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const content = completion.choices[0].message.content;
    if (!content) return undefined;
    const parsed = WorksSchema.safeParse(JSON.parse(content));
    if (!parsed.success) return undefined;
    const works = cleanTitles(parsed.data.works);
    await prisma.filmLocationCache.upsert({
      where: { cacheKey },
      create: { cacheKey, list: JSON.stringify({ works }) },
      update: { list: JSON.stringify({ works }) },
    });
    return works;
  } catch (err) {
    console.warn(`[filmLocations] ${cacheKey}: failed`, err);
    return undefined;
  }
}

export type FilmLocation = { place: PlaceCandidate; work: string; note: string };
export type FilmDay = { label: string; locations: FilmLocation[] };

const SEARCH_RADIUS_KM = 30;
// Only the first few results are about the work; later ones are nearby sights.
const TOP_RESULTS = 3;
// 須賀神社, its 男段 and "Your Name Stairs" are one place listed three times.
const SAME_SPOT_KM = 0.3;
const MAX_LOCATIONS = 4;

/** 「《你的名字》據說曾在這裡取景，出發前可以查證」 — we can't confirm the scene, only the place. */
export function filmNote(work: string): string {
  const title = work.replace(/^《|》$/g, "");
  return `《${title}》據說曾在這裡取景，出發前可以查證`;
}

/**
 * A work's filming locations from one Text Search (Pro, cached 30 days):
 * its top results that are sights near the city, not used yet, one per spot.
 */
export function locationsFrom(
  results: PlaceCandidate[],
  work: string,
  center: { lat: number; lng: number },
  taken: Set<string>,
  kept: FilmLocation[]
): FilmLocation[] {
  const found: FilmLocation[] = [];
  for (const candidate of results.slice(0, TOP_RESULTS)) {
    const place = pickHighlightMatch([candidate], center, taken);
    if (!place) continue;
    const sameSpot = [...kept, ...found].some((l) => haversineKm(l.place.lat, l.place.lng, place.lat, place.lng) <= SAME_SPOT_KM);
    if (sameSpot) continue;
    found.push({ place, work, note: filmNote(work) });
  }
  return found;
}

/**
 * A city's film day: for each title (or the city's best-known works), the
 * top results of 「<作品> 聖地巡禮」 near the city. One location is enough
 * for the day; its other hours go to nearby sights. Titled by the work when
 * there's one, otherwise 「影劇朝聖」.
 */
export async function findFilmDay(
  city: string,
  center: { lat: number; lng: number },
  apiKey: string,
  titles: string[],
  model: string,
  usedPlaceIds: Set<string>
): Promise<FilmDay | undefined> {
  const works = titles.length ? titles : await listFamousWorks(city, model);
  if (!works?.length) return undefined;

  const results = await Promise.all(
    works.map((work) =>
      searchTextCandidates(`${work} 聖地巡禮`, center, apiKey, SEARCH_RADIUS_KM * 1000).catch(() => [] as PlaceCandidate[])
    )
  );
  const taken = new Set(usedPlaceIds);
  const locations: FilmLocation[] = [];
  works.forEach((work, i) => {
    for (const location of locationsFrom(results[i], work, center, taken, locations)) {
      if (locations.length >= MAX_LOCATIONS) return;
      taken.add(location.place.placeId);
      locations.push(location);
    }
  });
  if (locations.length === 0) return undefined;
  const found = [...new Set(locations.map((l) => l.work.replace(/^《|》$/g, "")))];
  return { label: found.length === 1 ? `《${found[0]}》` : "影劇朝聖", locations };
}

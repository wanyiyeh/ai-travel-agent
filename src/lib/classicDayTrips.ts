import { z } from "zod";
import { COPY_PENDING } from "@/lib/copyPending";
import { openai } from "@/lib/openai";
import { prisma } from "@/lib/db";
import { searchTextCandidates, type PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { getCityCenter } from "@/lib/placesTextSearch";
import { haversineKm } from "@/lib/geo";
import { pickHighlightMatch } from "@/lib/seasonalHighlights";
import type { DayFixedEvents } from "@/lib/fixedEvents";

// 經典一日遊 (plan/form-preference-wiring.md 1.4, phase 3c-3): the day trips
// a city is known for — 鎌倉, 箱根, 日光 from 東京 — which lie beyond Nearby
// Search's 50km (suburbTrips.ts only reached 昭和紀念公園). The model lists
// the towns and a few sights in each, Text Search confirms them, and the
// day is spent there: train or car out, 2-3 sights, lunch, back.

// The interests a town can suit, the form's own tags.
const TRIP_INTERESTS = ["culture", "nature", "food", "shopping", "water", "land"] as const;

const TripListSchema = z.object({
  trips: z
    .array(
      z.object({
        /** The town, as a map search would find it: 「鎌倉」. */
        town: z.string().min(1),
        /** Its best-known sights, by their own names. */
        sights: z.array(z.string().min(1)).default([]),
        interests: z.array(z.string()).default([]),
      })
    )
    .default([]),
});
export type TripList = z.infer<typeof TripListSchema>;

const MAX_LISTED = 5;
const MAX_SIGHTS = 3;

function systemPrompt(city: string): string {
  return `你是旅遊規劃專家。請列出從「${city}」出發、最經典的當天來回一日遊目的地。

規則：
- 單程交通（火車或開車）大約 1～2 小時，離 ${city} 市中心約 40～150 km；不要列 ${city} 市區或近郊
- 最多 ${MAX_LISTED} 個，最有名的排前面
- 每個目的地列 2～${MAX_SIGHTS} 個當地最值得去的景點，寫地圖上搜得到的正式名稱；
  景點要彼此靠近，一天走得完
- interests 從這幾個選適合的：${TRIP_INTERESTS.join("、")}

回傳嚴格的 JSON（不要其他文字）：
{ "trips": [{ "town": "目的地", "sights": ["景點", "景點"], "interests": ["culture"] }] }`;
}

/**
 * The model's classic day trips from a city, cached per city (not per
 * month — 鎌倉 is a day trip from 東京 all year). A failed call isn't cached.
 */
export async function listClassicDayTrips(city: string, model: string): Promise<TripList | undefined> {
  try {
    const cached = await prisma.classicDayTripCache.findUnique({ where: { city } });
    if (cached) return TripListSchema.parse(JSON.parse(cached.list));

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt(city) },
        { role: "user", content: city },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    const content = completion.choices[0].message.content;
    if (!content) return undefined;
    const parsed = TripListSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      console.warn(`[classicDayTrips] ${city}: schema mismatch`, content);
      return undefined;
    }
    const list = { trips: parsed.data.trips.slice(0, MAX_LISTED).map((t) => ({ ...t, sights: t.sights.slice(0, MAX_SIGHTS) })) };
    await prisma.classicDayTripCache.upsert({
      where: { city },
      create: { city, list: JSON.stringify(list) },
      update: { list: JSON.stringify(list) },
    });
    return list;
  } catch (err) {
    console.warn(`[classicDayTrips] ${city}: failed`, err);
    return undefined;
  }
}

/** Towns that suit the traveler's interests first, otherwise the model's order (most famous first). */
export function byInterest<T extends { interests: string[] }>(trips: T[], interests: string[]): T[] {
  const fit = (t: T) => t.interests.filter((i) => interests.includes(i)).length;
  return trips.map((t, i) => ({ t, i })).sort((a, b) => fit(b.t) - fit(a.t) || a.i - b.i).map(({ t }) => t);
}

// About an hour to two out (plan 3c-3), straight-line. 鎌倉, the classic
// day trip from 東京, is only ~45km from Tokyo Station as the crow flies.
export const MIN_CLASSIC_KM = 40;
export const MAX_CLASSIC_KM = 150;
// The sights are within walking or a short ride of the town's center.
const SIGHT_RADIUS_KM = 15;
const MIN_SIGHTS = 2;

export type ClassicDayTrip = { town: string; km: number; sights: PlaceCandidate[] };

/**
 * The first listed town, by the traveler's interests, that is really
 * 50-150km out (getCityCenter, cached), that `accept` takes (not a town the
 * route already stays in), and where Text Search confirms at least 2 sights
 * (cached Pro requests). Undefined when none.
 */
export async function findClassicDayTrip(
  city: string,
  center: { lat: number; lng: number },
  apiKey: string,
  interests: string[],
  model: string,
  usedPlaceIds: Set<string>,
  acceptTown: (townCenter: { lat: number; lng: number }) => Promise<boolean> = async () => true,
  acceptSight: (place: PlaceCandidate) => Promise<boolean> = async () => true
): Promise<ClassicDayTrip | undefined> {
  const list = await listClassicDayTrips(city, model);
  for (const trip of byInterest(list?.trips ?? [], interests)) {
    const townCenter = await getCityCenter(trip.town, apiKey).catch(() => null);
    if (!townCenter) continue;
    const km = haversineKm(center.lat, center.lng, townCenter.lat, townCenter.lng);
    if (km < MIN_CLASSIC_KM || km > MAX_CLASSIC_KM || !(await acceptTown(townCenter))) continue;

    const taken = new Set(usedPlaceIds);
    const sights: PlaceCandidate[] = [];
    for (const name of trip.sights) {
      const found = await searchTextCandidates(name, townCenter, apiKey, SIGHT_RADIUS_KM * 1000).catch(() => [] as PlaceCandidate[]);
      const place = pickHighlightMatch(
        found.filter((p) => haversineKm(townCenter.lat, townCenter.lng, p.lat, p.lng) <= SIGHT_RADIUS_KM),
        townCenter,
        taken
      );
      if (!place || !(await acceptSight(place))) continue;
      taken.add(place.placeId);
      sights.push(place);
    }
    if (sights.length >= MIN_SIGHTS) return { town: trip.town, km, sights };
  }
  return undefined;
}

const SIGHT_MINUTES = 90;
const BETWEEN_SIGHTS_MINUTES = 20;
const LUNCH_MINUTES = 60;

/** One-way travel time, roughly: a train ride with transfers, or the drive, is about a minute a km. */
export function travelMinutes(km: number): number {
  return Math.min(150, Math.max(45, Math.round(km)));
}

const hoursLabel = (minutes: number) => {
  const h = Math.round((minutes / 60) * 2) / 2;
  return `${h % 1 === 0 ? h : h.toFixed(1)} 小時`;
};

/**
 * The day as back-to-back blocks from the morning to `dayEndMinute`, one
 * per sight, so the city gets no stops that day: the way out is in the first
 * block, lunch after it, the way back in the last. Sights that don't fit
 * (a long ride out) are dropped, keeping at least two.
 */
export function classicTripEvents(
  trip: ClassicDayTrip,
  city: string,
  dayStartMinute: number,
  dayEndMinute: number,
  selfDrive: boolean
): DayFixedEvents {
  const travel = travelMinutes(trip.km);
  const fits = (n: number) =>
    travel * 2 + n * SIGHT_MINUTES + (n - 1) * BETWEEN_SIGHTS_MINUTES + LUNCH_MINUTES <= dayEndMinute - dayStartMinute;
  let count = trip.sights.length;
  while (count > MIN_SIGHTS && !fits(count)) count--;
  const sights = trip.sights.slice(0, count);

  const by = selfDrive ? "開車" : "搭火車";
  let start = dayStartMinute;
  return sights.map((place, i) => {
    const first = i === 0;
    const last = i === sights.length - 1;
    const begin = start;
    // What comes before the sight inside its block: the way out, or lunch
    // and a short hop. No gaps between blocks, or a city stop would slip in.
    const lead = first ? travel : (i === 1 ? LUNCH_MINUTES : 0) + BETWEEN_SIGHTS_MINUTES;
    const end = last ? Math.max(dayEndMinute, begin + lead + SIGHT_MINUTES) : begin + lead + SIGHT_MINUTES;
    start = end;
    const notes = [
      ...(first ? [`一日遊：從${city}${by}約 ${hoursLabel(travel)}到${trip.town}`] : []),
      ...(last ? [`傍晚${by}回${city}，約 ${hoursLabel(travel)}`] : []),
    ];
    const minuteOfDay = begin + lead;
    return {
      block: { startMinute: begin, endMinute: end },
      stop: {
        id: crypto.randomUUID(),
        placeId: place.placeId,
        name: place.name,
        description: notes.join("。"),
        [COPY_PENDING]: true,
        duration_minutes: SIGHT_MINUTES,
        time_of_day: minuteOfDay < 12 * 60 ? "morning" : "afternoon",
        lat: place.lat,
        lng: place.lng,
        address: place.address,
        rating: place.rating ?? null,
        photoName: place.photoName ?? null,
      },
    };
  });
}

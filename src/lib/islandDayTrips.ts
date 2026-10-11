import { fetchNearbyPlaceCandidates, type PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { classicTripEvents, type ClassicDayTrip } from "@/lib/classicDayTrips";
import type { DayFixedEvents } from "@/lib/fixedEvents";
import { islandGroupOf, islandNamed, type Island } from "@/lib/islandGroups";
import type { SuburbKind } from "@/lib/suburbKind";

// 坐船一日遊 (plan/island-trips.md, PR 2): on 馬祖 or 澎湖 the day out is a
// boat to a neighbouring island, not the mainland suburb rule's 「上午在郊區，
// 下午回市區」. Ferry times are estimates, so each trip says to check the boats.

// A whole day there and back by boat, or a morning for the short, frequent crossings.
const DAY_TRIP_MAX_FERRY_MINUTES = 90;
const HALF_DAY_MAX_FERRY_MINUTES = 30;
// Getting to the pier and on board.
const BOARDING_MINUTES = 30;
// A half day comes back for a late lunch; the afternoon stays on the home island.
const HALF_DAY_BACK_MINUTE = 14 * 60;

/**
 * Islands a stay on `cityName` can visit for the day, in the group's order:
 * only from the island the plane arrives at (whose crossings the data has),
 * and not 東引 (one boat a day, two hours each way).
 */
export function islandDayTripOptions(cityName: string, kind: SuburbKind, routeCityNames: string[] = []): Island[] {
  const group = islandGroupOf(cityName);
  if (!group || islandNamed(cityName) !== group.main) return [];
  return group.others.filter(
    (island) =>
      // Not one the trip stays the night on anyway (北竿 twice, 芹壁 both times).
      !routeCityNames.includes(island.name) &&
      island.ferry &&
      (kind === "day"
        ? island.ferry.minutes <= DAY_TRIP_MAX_FERRY_MINUTES
        : island.ferry.frequent && island.ferry.minutes <= HALF_DAY_MAX_FERRY_MINUTES)
  );
}

export type IslandDayTrip = { island: Island; sights: PlaceCandidate[] };

const SIGHTS = { day: 3, half: 2 } as const;
const MIN_SIGHTS = { day: 2, half: 1 } as const;

/**
 * The first island with enough sights not already on the trip (one Nearby
 * Search per island tried, cached). The search is centered on that island,
 * so only its own places come back (islandGroups.ts onSearchIsland).
 */
export async function findIslandDayTrip(
  cityName: string,
  apiKey: string,
  kind: SuburbKind,
  usedPlaceIds: Set<string>,
  routeCityNames: string[] = []
): Promise<IslandDayTrip | undefined> {
  for (const island of islandDayTripOptions(cityName, kind, routeCityNames)) {
    const found = await fetchNearbyPlaceCandidates(island.center, apiKey, ["tourist_attraction"], 10000, 20).catch(
      () => [] as PlaceCandidate[]
    );
    const sights = found.filter((p) => !usedPlaceIds.has(p.placeId)).slice(0, SIGHTS[kind]);
    if (sights.length >= MIN_SIGHTS[kind]) return { island, sights };
  }
  return undefined;
}

/** The day's blocks: the boat over before the first sight, back after the last. */
export function islandTripEvents(
  trip: IslandDayTrip,
  homeIsland: string,
  kind: SuburbKind,
  dayStartMinute: number,
  dayEndMinute: number
): DayFixedEvents {
  const ferry = trip.island.ferry!;
  const crossing = ferry.minutes + BOARDING_MINUTES + (ferry.landMinutes ?? 0);
  const reach = ferry.landMinutes ? `開車或搭車約 ${ferry.landMinutes} 分到${ferry.port}，` : `從${ferry.port}`;
  const classic: ClassicDayTrip = { town: trip.island.name, km: 0, sights: trip.sights };
  return classicTripEvents(classic, homeIsland, dayStartMinute, kind === "day" ? dayEndMinute : HALF_DAY_BACK_MINUTE, false, {
    minutes: crossing,
    out: `${kind === "day" ? "坐船一日遊" : "坐船半日遊"}：${reach}搭船約 ${ferry.minutes} 分到${trip.island.name}（估計，出發前確認船班，會依季節和海象調整）`,
    back: `${kind === "day" ? "傍晚" : "中午過後"}搭船回${homeIsland}`,
  });
}

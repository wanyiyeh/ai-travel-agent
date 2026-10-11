import { haversineKm } from "@/lib/geo";
import { AIRPORTS } from "@/lib/airports";

// 離島的島群 (plan/island-trips.md): the islands a 國內 trip to 馬祖 or 澎湖
// can reach by boat. Kept apart from AIRPORTS — 北竿 or 七美 aren't places
// the form offers to fly to. 金門's two islands are joined by a bridge, and
// 綠島, 蘭嶼 and 小琉球 are single islands, so only these two are groups.
// Ferry times are estimates (2026-10-11, from travel guides and news): a
// trip says so and to check the boats before going.

type Point = { lat: number; lng: number };

export type Island = {
  name: string;
  /** Where the island's sights are planned from. */
  center: Point;
  /**
   * More points on the island for telling which island a place is on: the
   * nearest point wins. 澎湖's main island runs from 馬公 up to 白沙's 赤崁,
   * bridged together, and 赤崁 is closer to 吉貝's center than to 馬公.
   */
  anchors?: Point[];
  /** By boat from the main island, or from another port of it (吉貝 from 赤崁, `landMinutes` from 馬公). */
  ferry?: { port: string; minutes: number; frequent: boolean; landMinutes?: number };
};

export type IslandGroup = {
  /** The island the plane or boat from Taiwan arrives at. */
  main: Island;
  others: Island[];
};

export const ISLAND_GROUPS: Record<string, IslandGroup> = {
  "TW-MZU": {
    main: { name: "南竿", center: { lat: 26.1555, lng: 119.9354 } },
    others: [
      { name: "北竿", center: { lat: 26.2215, lng: 119.9902 }, ferry: { port: "南竿福澳港", minutes: 20, frequent: true } },
      {
        name: "莒光",
        center: { lat: 25.9645, lng: 119.9555 },
        anchors: [
          { lat: 25.9608, lng: 119.9744 }, // 東莒
          { lat: 25.9706, lng: 119.9311 }, // 西莒
        ],
        ferry: { port: "南竿福澳港", minutes: 50, frequent: false },
      },
      { name: "東引", center: { lat: 26.3664, lng: 120.4931 }, ferry: { port: "南竿福澳港", minutes: 120, frequent: false } },
    ],
  },
  "TW-PEH": {
    main: {
      name: "澎湖",
      center: { lat: 23.5665, lng: 119.5793 }, // 馬公
      anchors: [
        { lat: 23.5805, lng: 119.6512 }, // 湖西
        { lat: 23.6563, lng: 119.5876 }, // 白沙
        { lat: 23.7052, lng: 119.6011 }, // 赤崁
        { lat: 23.6007, lng: 119.5048 }, // 西嶼
        { lat: 23.539, lng: 119.553 }, // 風櫃, as close to 桶盤 as to 馬公
      ],
    },
    others: [
      // A day out picks the first that fits: the classic 七美 and 望安 first.
      { name: "七美", center: { lat: 23.2059, lng: 119.4303 }, ferry: { port: "馬公港", minutes: 70, frequent: false } },
      { name: "望安", center: { lat: 23.3608, lng: 119.5037 }, ferry: { port: "馬公港", minutes: 50, frequent: false } },
      {
        name: "吉貝",
        center: { lat: 23.7425, lng: 119.6046 },
        ferry: { port: "白沙赤崁碼頭", minutes: 20, frequent: true, landMinutes: 30 },
      },
      { name: "桶盤", center: { lat: 23.5045, lng: 119.5196 }, ferry: { port: "馬公港", minutes: 15, frequent: true } },
      { name: "虎井", center: { lat: 23.4864, lng: 119.5218 }, ferry: { port: "馬公港", minutes: 15, frequent: true } },
    ],
  },
};

const GROUP_BY_NAME = new Map<string, IslandGroup>();
const ISLAND_BY_NAME = new Map<string, Island>();
for (const group of Object.values(ISLAND_GROUPS)) {
  for (const island of [group.main, ...group.others]) {
    GROUP_BY_NAME.set(island.name, group);
    ISLAND_BY_NAME.set(island.name, island);
  }
}
// The group's own name (the AIRPORTS cityZh) means its main island.
GROUP_BY_NAME.set("馬祖", ISLAND_GROUPS["TW-MZU"]);
ISLAND_BY_NAME.set("馬祖", ISLAND_GROUPS["TW-MZU"].main);
ISLAND_BY_NAME.set("澎湖", ISLAND_GROUPS["TW-PEH"].main);

// Every island a trip can stay on: the groups' islands and the single ones (綠島, 蘭嶼, 小琉球, 金門).
const ISLAND_CITY_NAMES = new Set([
  ...ISLAND_BY_NAME.keys(),
  ...Object.values(AIRPORTS)
    .filter((a) => a.island)
    .map((a) => a.cityZh),
]);

/** Whether a stay is on an island: a day out is then by boat, not the mainland suburb rule. */
export function isIslandCity(cityName: string): boolean {
  return ISLAND_CITY_NAMES.has(cityName);
}

/** The island a city name stands for: 「馬祖」 is 南竿, 「北竿」 is 北竿. */
export function islandNamed(cityName: string): Island | undefined {
  return ISLAND_BY_NAME.get(cityName);
}

/** The group an island (or the group's own name) belongs to. */
export function islandGroupOf(cityName: string): IslandGroup | undefined {
  return GROUP_BY_NAME.get(cityName);
}

/** Which of the group's islands a point is on: the one with the nearest center or anchor. */
export function islandAt(point: Point, group: IslandGroup): Island {
  const islands = [group.main, ...group.others];
  const distance = (island: Island) =>
    Math.min(...[island.center, ...(island.anchors ?? [])].map((p) => haversineKm(point.lat, point.lng, p.lat, p.lng)));
  return islands.reduce((best, island) => (distance(island) < distance(best) ? island : best));
}

// How far from an island's own points a search center may be and still be
// that island's — a search near 南竿 is 南竿's, one out in Taiwan isn't any.
const ISLAND_SEARCH_KM = 15;

/**
 * Places found around `center`, kept to the island `center` is on: the boat
 * isn't a taxi ride (芹壁 on 北竿 turned up on a 南竿 day). A search
 * anywhere else is left alone.
 */
export function onSearchIsland<T extends Point>(center: Point, places: T[]): T[] {
  const found = islandContaining(center);
  return found ? places.filter((p) => islandAt(p, found.group) === found.island) : places;
}

/** The group island a point is on or by, if any. */
export function islandContaining(point: Point): { group: IslandGroup; island: Island } | undefined {
  for (const group of Object.values(ISLAND_GROUPS)) {
    const island = islandAt(point, group);
    const near = [island.center, ...(island.anchors ?? [])].some(
      (p) => haversineKm(point.lat, point.lng, p.lat, p.lng) <= ISLAND_SEARCH_KM
    );
    if (near) return { group, island };
  }
  return undefined;
}

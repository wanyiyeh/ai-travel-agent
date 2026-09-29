import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";
import type { MealType } from "@/types/itinerary";
import { estimateMealCost, estimateLodgingCostPerNight, estimateLodgingCostRange } from "@/lib/priceLevelCost";

// Real Nearby Search candidates for one city's meals and accommodation, handed
// to the LLM as numbered lists so it picks real places instead of inventing
// names. The old flow had the LLM make every name up, then paid one Text
// Search per meal/hotel during enrich to find out where it was — and names it
// invented outright came back "not found" (see plan/places-api-cost-reduction.md).
// A pick carries the candidate's placeId/coords straight through, so enrich
// skips it entirely.

export type MealLodgingPools = {
  breakfast: PlaceCandidate[];
  main: PlaceCandidate[]; // shared by lunch and dinner
  snack: PlaceCandidate[];
  lodging: PlaceCandidate[];
};

type PoolKey = keyof MealLodgingPools;

const ID_PREFIX: Record<PoolKey, string> = { breakfast: "B", main: "M", snack: "S", lodging: "H" };
const POOL_FOR_MEAL: Record<MealType, PoolKey> = { breakfast: "breakfast", lunch: "main", dinner: "main", snack: "snack" };
const MEAL_KEYS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

function candidateId(pool: PoolKey, index: number): string {
  return `${ID_PREFIX[pool]}${index + 1}`;
}

function findCandidate(pools: MealLodgingPools, pool: PoolKey, id: unknown): PlaceCandidate | undefined {
  if (typeof id !== "string" || !id.startsWith(ID_PREFIX[pool])) return undefined;
  const index = Number(id.slice(ID_PREFIX[pool].length)) - 1;
  return Number.isInteger(index) ? pools[pool][index] : undefined;
}

export function hasAnyCandidates(pools: MealLodgingPools): boolean {
  return Object.values(pools).some((p) => p.length > 0);
}

// The candidate lists as they appear in the prompt, one line per place.
export function formatCandidateLists(pools: MealLodgingPools): string {
  const section = (title: string, pool: PoolKey) => {
    const lines = pools[pool].map(
      (c, i) => `${candidateId(pool, i)}: ${c.name}${c.rating ? `（${c.rating}★）` : ""}`,
    );
    return `${title}：\n${lines.length > 0 ? lines.join("\n") : "（無候選，請自行推薦真實店家，id 填 null）"}`;
  };
  return [
    section("住宿候選", "lodging"),
    section("早餐候選", "breakfast"),
    section("午餐／晚餐候選", "main"),
    section("點心候選", "snack"),
  ].join("\n\n");
}

type RawPick = Record<string, unknown>;

// Replaces each LLM pick that names a valid, not-yet-used candidate id with
// that candidate's real data. Anything else (no id, unknown id, a candidate
// already picked for another slot) keeps the LLM's own name/description, same
// as before this change — enrich then resolves it the old way.
export function applyCandidatePicks(
  parsed: { accommodation?: RawPick; meals?: RawPick[] },
  pools: MealLodgingPools,
  stayDays: number,
  currency: string,
): { accommodation: Record<string, unknown>; mealsByDay: Array<Record<string, unknown>> } {
  const used = new Set<PlaceCandidate>();

  const stripId = (raw: RawPick) => {
    const rest = { ...raw };
    delete rest.id;
    return rest;
  };

  const rawAcc = parsed.accommodation ?? {};
  const hotel = findCandidate(pools, "lodging", rawAcc.id);
  let accommodation: Record<string, unknown> = stripId(rawAcc);
  if (hotel) {
    used.add(hotel);
    const range = estimateLodgingCostRange(currency, hotel.priceLevel);
    const perNight = estimateLodgingCostPerNight(currency, hotel.priceLevel);
    accommodation = {
      name: hotel.name,
      area: typeof rawAcc.area === "string" && rawAcc.area ? rawAcc.area : hotel.address,
      placeId: hotel.placeId,
      lat: hotel.lat,
      lng: hotel.lng,
      address: hotel.address,
      rating: hotel.rating ?? null,
      priceLevel: hotel.priceLevel ?? null,
      photoName: hotel.photoName ?? null,
      ...(perNight !== undefined ? { estimated_cost: perNight } : {}),
      ...(range ? { estimated_cost_low: range[0], estimated_cost_high: range[1] } : {}),
    };
  }

  const mealsByDay = Array.from({ length: stayDays }, (_, dayIdx) => {
    const rawDay = parsed.meals?.[dayIdx] ?? {};
    const day: Record<string, unknown> = {};
    for (const mealKey of MEAL_KEYS) {
      const raw = rawDay[mealKey] as RawPick | undefined;
      if (!raw || typeof raw !== "object") continue;
      const place = findCandidate(pools, POOL_FOR_MEAL[mealKey], raw.id);
      if (!place || used.has(place)) {
        day[mealKey] = stripId(raw);
        continue;
      }
      used.add(place);
      const estimated = estimateMealCost(currency, mealKey, place.priceLevel);
      day[mealKey] = {
        name: place.name,
        description: raw.description,
        estimated_cost: estimated ?? raw.estimated_cost,
        placeId: place.placeId,
        lat: place.lat,
        lng: place.lng,
        address: place.address,
        rating: place.rating ?? null,
        photoName: place.photoName ?? null,
      };
    }
    return day;
  });

  return { accommodation, mealsByDay };
}

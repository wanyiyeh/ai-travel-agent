import type { PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { matchesBrand, type BrandNames } from "@/lib/brandMatch";

// The home form's 飲品 choice (plan/form-preference-wiring.md 1.8): coffee or
// tea places take over the afternoon snack, and a coffee lover's breakfast
// leans to coffee places too.

export type DrinkKey = "coffee" | "tea";
/** Every 飲品 choice on the form; alcohol adds a 小酌 instead of changing the snack. */
export type DrinkChoice = DrinkKey | "alcohol";

type Drink = {
  /** Text Search query — Nearby Search can't filter by rating, Text Search can (minRating). */
  query: string;
  /** Primary types that count; a matcha search also returns full restaurants. */
  primaryTypes: string[];
};

export const DRINKS: Record<DrinkKey, Drink> = {
  coffee: { query: "specialty coffee", primaryTypes: ["coffee_shop", "coffee_roastery", "coffee_stand", "cafe"] },
  tea: {
    query: "matcha",
    primaryTypes: ["tea_house", "cafe", "coffee_shop", "dessert_shop", "dessert_restaurant", "confectionery"],
  },
};

// Applied server-side by Text Search, so it costs no Enterprise rating field.
// Google ratings run low in Japan; plenty of good places there sit around 3.5-4.0.
export const DRINK_MIN_RATING = 3.5;

// Chains found in any city — no one travels for these, and travelers from
// Taiwan have Louisa and 85°C at home. Their flagship roasteries are
// destinations in their own right, so those stay.
const GLOBAL_CHAINS: BrandNames = {
  latin: ["starbucks", "mcdonald's", "mcdonalds", "mccafé", "mccafe", "costa coffee", "dunkin", "tim hortons", "pret a manger", "caffè nero", "caffe nero", "louisa", "85c"],
  cjk: ["星巴克", "スターバックス", "麥當勞", "マクドナルド", "路易莎", "85度c", "85°c"],
};
const FLAGSHIP: BrandNames = { latin: ["reserve", "roastery"], cjk: ["臻選", "リザーブ", "ロースタリー"] };

// Local chains are part of the experience (Komeda in Nagoya), so they stay,
// but each brand only once: different branches have different placeIds, and
// three Doutors in one trip isn't a recommendation.
const LOCAL_CHAINS: BrandNames[] = [
  { latin: ["komeda"], cjk: ["コメダ", "客美多"] },
  { latin: ["doutor"], cjk: ["ドトール", "羅多倫"] },
  { latin: ["tully's", "tullys"], cjk: ["タリーズ"] },
  { latin: ["excelsior"], cjk: ["エクセルシオール"] },
  { latin: ["hoshino coffee"], cjk: ["星乃珈琲"] },
  { latin: ["saint marc"], cjk: ["サンマルク"] },
  { latin: ["ueshima"], cjk: ["上島珈琲"] },
  { latin: ["blue bottle"], cjk: ["ブルーボトル", "藍瓶"] },
  { latin: ["arabica"], cjk: ["アラビカ"] },
  { latin: ["nana's green tea"], cjk: ["ナナズ"] },
  { latin: ["tsujiri"], cjk: ["辻利"] },
];

/** A chain found in any city (Starbucks, McDonald's, ...), not worth a traveler's meal or coffee — flagship roasteries aside. */
export function isGlobalChain(name: string): boolean {
  return matchesBrand(name, GLOBAL_CHAINS) && !matchesBrand(name, FLAGSHIP);
}

/**
 * A drink search's results narrowed to places that suit it: the right
 * primary type, no global chains, and at most one branch per local chain
 * (the first, most relevant one). Order is kept.
 */
export function selectDrinkPlaces<T extends Pick<PlaceCandidate, "name" | "types">>(places: T[], drink: DrinkKey): T[] {
  const usedChains = new Set<BrandNames>();
  return places.filter((place) => {
    if (!DRINKS[drink].primaryTypes.includes(place.types?.[0] ?? "")) return false;
    if (isGlobalChain(place.name)) return false;
    const chain = LOCAL_CHAINS.find((brand) => matchesBrand(place.name, brand));
    if (!chain) return true;
    if (usedChains.has(chain)) return false;
    usedChains.add(chain);
    return true;
  });
}

/** Lists merged one from each in turn, without repeating a place. */
export function interleave<T extends { placeId: string }>(lists: T[][]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) {
    for (const list of lists) {
      const place = list[i];
      if (place && !seen.has(place.placeId)) {
        seen.add(place.placeId);
        out.push(place);
      }
    }
  }
  return out;
}

// The 小酌 after dinner: bars of every kind, and izakaya — in Japan an
// izakaya is where a night of drinking happens. snack_bar is left out: in
// Japan a スナック is a hostess bar.
export const NIGHTCAP_TYPES = [
  "bar", "wine_bar", "cocktail_bar", "lounge_bar", "pub", "beer_garden", "brewpub", "japanese_izakaya_restaurant",
];

/** Whether a place from the 小酌 search is primarily a bar or izakaya. */
export function isNightcapPlace(place: Pick<PlaceCandidate, "types">): boolean {
  return NIGHTCAP_TYPES.includes(place.types?.[0] ?? "");
}

const isIzakaya = (place: Pick<PlaceCandidate, "types">) => place.types?.[0] === "japanese_izakaya_restaurant";

/**
 * Bars before izakaya. The most popular izakaya are mostly about food — a
 * Tokyo trip's 小酌 was a famous udon place and a teppanyaki spot, right after
 * dinner — so izakaya only come in when bars run short. With `nights` given
 * and enough bars to cover them, izakaya are left out entirely: the AI picks
 * from the whole list regardless of order.
 */
export function barsFirst<T extends Pick<PlaceCandidate, "types">>(places: T[], nights?: number): T[] {
  const bars = places.filter((p) => !isIzakaya(p));
  if (nights !== undefined && bars.length >= nights) return bars;
  return [...bars, ...places.filter(isIzakaya)];
}

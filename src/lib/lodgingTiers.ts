import type { BudgetLevel, PlaceCandidate } from "@/lib/fetchCityRestaurants";
import { matchesBrand, type BrandNames } from "@/lib/brandMatch";

// Hilton/Marriott-tier international brands for the luxury budget
// (plan/form-preference-wiring.md 1.3). Google has no star-rating field, so
// brand is the most reliable signal. Searches use languageCode zh-TW, so
// chains often come back under their Chinese name — both spellings listed.
// Matched by brandMatch.ts; the Chinese forms are specific enough to match as
// substrings, except a few that are also ordinary words (四季, 半島), which
// need the 酒店 suffix.
// W Hotels is left out: properties are named just "W <city>", too short to
// match without false positives.
const LATIN_LUXURY_BRANDS = [
  "hilton", "conrad", "waldorf astoria", "marriott", "ritz-carlton", "st. regis",
  "westin", "sheraton", "le méridien", "edition", "hyatt", "andaz",
  "intercontinental", "regent", "kimpton", "sofitel", "fairmont", "raffles", "pullman",
  "four seasons", "mandarin oriental", "peninsula", "shangri-la", "banyan tree", "aman", "rosewood",
  // Taiwan's own (國內, plan/form-preference-wiring.md phase 5d) and 大倉, also in Tokyo.
  "silks place", "the lalu", "okura", "evergreen laurel", "grand hi-lai", "kagaya",
];
const CJK_LUXURY_BRANDS = [
  "希爾頓", "康萊德", "華爾道夫", "萬豪", "麗思卡爾頓", "瑞吉", "威斯汀", "喜來登",
  "凱悅", "君悅", "柏悅", "安達仕", "洲際", "麗晶", "索菲特", "費爾蒙", "萊佛士", "鉑爾曼",
  // 艾美 alone is also in local names: 花蓮潔西艾美渡假酒店 isn't a Le Méridien.
  "四季酒店", "文華東方", "半島酒店", "香格里拉", "悅榕", "安縵", "瑰麗", "艾美酒店",
  // Taiwan's own. 老爺 needs the 酒店 (台南老爺行旅 is the group's mid-range line);
  // 圓山, 漢來 and 國賓 the 大飯店 (also restaurants and places).
  "晶華", "晶英", "涵碧樓", "雲品", "君品", "寒舍艾麗", "大倉久和", "長榮桂冠", "加賀屋",
  "老爺酒店", "老爺大酒店", "圓山大飯店", "漢來大飯店", "國賓大飯店", "美福大飯店",
];
const LUXURY_BRANDS: BrandNames = { latin: LATIN_LUXURY_BRANDS, cjk: CJK_LUXURY_BRANDS };

// A luxury group's mid-range line: 澎湖福朋喜來登酒店 is a Four Points, not a Sheraton.
const MID_RANGE_LINES: BrandNames = { latin: ["four points"], cjk: ["福朋"] };

export function isLuxuryBrand(name: string): boolean {
  return matchesBrand(name, LUXURY_BRANDS) && !matchesBrand(name, MID_RANGE_LINES);
}

/** Brand-name match, or Google's own primary type says resort. */
export function isLuxuryLodging(place: Pick<PlaceCandidate, "name" | "types">): boolean {
  return isLuxuryBrand(place.name) || place.types?.[0] === "resort_hotel";
}

// Enough in-tier places that the LLM / picker still has a real choice.
const MIN_TIER_MATCHES = 3;

// The budget tier: hostels first, but any of these counts. Hostels alone were
// too few to trigger the filter (fewer than 3 among Asakusa's popular
// lodging), so a budget Tokyo trip got the 4-star Asakusa View Hotel.
const BUDGET_LODGING_TYPES = new Set(["hostel", "guest_house", "bed_and_breakfast", "budget_japanese_inn", "motel"]);

/** Whether Google's primary type puts a place in the budget lodging tier. */
export function isBudgetLodging(place: Pick<PlaceCandidate, "types">): boolean {
  return BUDGET_LODGING_TYPES.has(place.types?.[0] ?? "");
}

/**
 * Narrows a lodging pool to the budget tier. Ordering alone wasn't enough:
 * a budget trip to Sapporo still got the ANA Crowne Plaza, because the LLM
 * picks from the whole list regardless of order. So when at least
 * MIN_TIER_MATCHES places fit the tier, only those are kept:
 * - budget: budget lodging types (hostels, guest houses, B&Bs, budget inns,
 *   motels — by primary type), hostels first
 * - moderate: anything but luxury brands/resorts (its "hotel" search also
 *   returns Hiltons)
 * - luxury: luxury brands/resorts
 * With fewer matches, the matches go first and the rest follow, so a small
 * town still gets somewhere to stay. Google's popularity order is kept within
 * each group. No budget: unchanged.
 */
export function rankLodgingByBudget<T extends Pick<PlaceCandidate, "name" | "types">>(
  places: T[],
  budget: BudgetLevel | undefined
): T[] {
  const fits =
    budget === "budget"
      ? isBudgetLodging
      : budget === "moderate"
        ? (p: T) => !isLuxuryLodging(p)
        : budget === "luxury"
          ? isLuxuryLodging
          : null;
  if (!fits) return places;
  const isHostel = (p: T) => p.types?.[0] === "hostel";
  const inTier = places.filter(fits);
  const matches = budget === "budget" ? [...inTier.filter(isHostel), ...inTier.filter((p) => !isHostel(p))] : inTier;
  if (matches.length >= MIN_TIER_MATCHES) return matches;
  return [...matches, ...places.filter((p) => !fits(p))];
}

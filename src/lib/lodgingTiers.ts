import type { BudgetLevel, PlaceCandidate } from "@/lib/fetchCityRestaurants";

// Hilton/Marriott-tier international brands for the luxury budget
// (plan/form-preference-wiring.md 1.3). Google has no star-rating field, so
// brand is the most reliable signal. Searches use languageCode zh-TW, so
// chains often come back under their Chinese name — both spellings listed.
// Latin names match as whole words ("Aman" must not match "Yamanote"); the
// Chinese forms are specific enough to match as substrings, except a few
// that are also ordinary words (四季, 半島), which need the 酒店 suffix.
// W Hotels is left out: properties are named just "W <city>", too short to
// match without false positives.
const LATIN_LUXURY_BRANDS = [
  "hilton", "conrad", "waldorf astoria", "marriott", "ritz-carlton", "st. regis",
  "westin", "sheraton", "le méridien", "edition", "hyatt", "andaz",
  "intercontinental", "regent", "kimpton", "sofitel", "fairmont", "raffles", "pullman",
  "four seasons", "mandarin oriental", "peninsula", "shangri-la", "banyan tree", "aman", "rosewood",
];
const CJK_LUXURY_BRANDS = [
  "希爾頓", "康萊德", "華爾道夫", "萬豪", "麗思卡爾頓", "瑞吉", "威斯汀", "喜來登", "艾美",
  "凱悅", "君悅", "柏悅", "安達仕", "洲際", "麗晶", "索菲特", "費爾蒙", "萊佛士", "鉑爾曼",
  "四季酒店", "文華東方", "半島酒店", "香格里拉", "悅榕", "安縵", "瑰麗",
];
const isLatinLetter = (ch: string | undefined) => ch !== undefined && ch >= "a" && ch <= "z";

// Whole-word substring match, done by hand rather than by building a RegExp
// from the brand list, so no brand ever needs escaping.
function containsWord(text: string, word: string): boolean {
  for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + 1)) {
    if (!isLatinLetter(text[i - 1]) && !isLatinLetter(text[i + word.length])) return true;
  }
  return false;
}

export function isLuxuryBrand(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    LATIN_LUXURY_BRANDS.some((brand) => containsWord(lower, brand)) ||
    CJK_LUXURY_BRANDS.some((brand) => lower.includes(brand))
  );
}

/** Brand-name match, or Google's own primary type says resort. */
export function isLuxuryLodging(place: Pick<PlaceCandidate, "name" | "types">): boolean {
  return isLuxuryBrand(place.name) || place.types?.[0] === "resort_hotel";
}

// Enough in-tier places that the LLM / picker still has a real choice.
const MIN_TIER_MATCHES = 3;

/**
 * Narrows a lodging pool to the budget tier. Ordering alone wasn't enough:
 * a budget trip to Sapporo still got the ANA Crowne Plaza, because the LLM
 * picks from the whole list regardless of order. So when at least
 * MIN_TIER_MATCHES places fit the tier, only those are kept:
 * - budget: hostels (by primary type)
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
      ? (p: T) => p.types?.[0] === "hostel"
      : budget === "moderate"
        ? (p: T) => !isLuxuryLodging(p)
        : budget === "luxury"
          ? isLuxuryLodging
          : null;
  if (!fits) return places;
  const matches = places.filter(fits);
  if (matches.length >= MIN_TIER_MATCHES) return matches;
  return [...matches, ...places.filter((p) => !fits(p))];
}

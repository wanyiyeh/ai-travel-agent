// Converts Google Places' 0-4 priceLevel (see PRICE_LEVEL_MAP in
// fetchCityRestaurants.ts) into a concrete estimated_cost, so a real signal
// from Google can override the LLM's initial guess instead of it being the
// only source of truth for the whole trip.

type MealType = "breakfast" | "lunch" | "dinner";
type Range = [number, number];

// Same reference ranges embedded as prose in itineraryGen.ts's system prompt
// (rule 12) — kept here as structured data so they can double as a real
// priceLevel → amount lookup, not just LLM guidance text.
export const MEAL_PRICE_RANGES: Record<string, Record<MealType, Range>> = {
  JPY: { breakfast: [500, 1000], lunch: [1000, 2000], dinner: [2000, 5000] },
  EUR: { breakfast: [8, 15], lunch: [15, 25], dinner: [30, 60] },
  GBP: { breakfast: [8, 15], lunch: [15, 25], dinner: [30, 60] },
  CHF: { breakfast: [15, 25], lunch: [25, 40], dinner: [50, 100] },
  AUD: { breakfast: [15, 25], lunch: [20, 35], dinner: [40, 80] },
  NZD: { breakfast: [15, 25], lunch: [20, 35], dinner: [40, 80] },
  USD: { breakfast: [10, 20], lunch: [15, 30], dinner: [30, 60] },
  TWD: { breakfast: [50, 120], lunch: [120, 250], dinner: [250, 600] },
  KRW: { breakfast: [5000, 10000], lunch: [8000, 15000], dinner: [15000, 40000] },
  THB: { breakfast: [60, 150], lunch: [100, 250], dinner: [200, 600] },
  SGD: { breakfast: [4, 10], lunch: [10, 20], dinner: [20, 50] },
  HKD: { breakfast: [30, 80], lunch: [60, 130], dinner: [150, 350] },
  VND: { breakfast: [30000, 80000], lunch: [60000, 150000], dinner: [100000, 300000] },
  MYR: { breakfast: [5, 15], lunch: [10, 25], dinner: [20, 60] },
  IDR: { breakfast: [20000, 50000], lunch: [40000, 100000], dinner: [80000, 250000] },
  SEK: { breakfast: [80, 150], lunch: [150, 280], dinner: [350, 800] },
  DKK: { breakfast: [60, 120], lunch: [120, 220], dinner: [280, 650] },
  NOK: { breakfast: [90, 160], lunch: [160, 280], dinner: [350, 850] },
  ZAR: { breakfast: [80, 150], lunch: [150, 300], dinner: [300, 700] },
};

// Per-night lodging price by tier (inexpensive/moderate/expensive/very
// expensive), authored at the same order of magnitude as MEAL_PRICE_RANGES
// for each currency — there's no equivalent prose reference for this in the
// generation prompt yet, this is the first structured estimate for lodging.
const LODGING_PRICE_TIERS: Record<string, [number, number, number, number]> = {
  JPY: [6000, 12000, 22000, 45000],
  EUR: [50, 90, 160, 300],
  GBP: [50, 90, 160, 300],
  CHF: [90, 160, 280, 500],
  AUD: [80, 150, 260, 450],
  NZD: [80, 150, 260, 450],
  USD: [60, 120, 220, 400],
  TWD: [1200, 2500, 4500, 8000],
  KRW: [60000, 120000, 220000, 400000],
  THB: [700, 1500, 3000, 6000],
  SGD: [60, 130, 250, 450],
  HKD: [400, 800, 1500, 3000],
  VND: [400000, 900000, 1800000, 3500000],
  MYR: [80, 180, 350, 650],
  IDR: [250000, 550000, 1100000, 2200000],
  SEK: [600, 1100, 2000, 3800],
  DKK: [500, 900, 1700, 3200],
  NOK: [700, 1300, 2400, 4500],
  ZAR: [700, 1400, 2600, 5000],
};

/**
 * priceLevel is Google's 0-4 scale (see PRICE_LEVEL_MAP): 0 = free, 1-4 =
 * inexpensive..very expensive. 0/null/undefined means "no usable signal" —
 * callers should keep whatever estimated_cost already existed rather than
 * treat it as a real free-of-charge signal (real restaurants/hotels are
 * essentially never tagged PRICE_LEVEL_FREE by Google).
 */
export function estimateMealCost(
  currency: string | undefined,
  mealType: MealType,
  priceLevel: number | null | undefined,
): number | undefined {
  if (!priceLevel || priceLevel < 1) return undefined;
  const range = currency ? MEAL_PRICE_RANGES[currency]?.[mealType] : undefined;
  if (!range) return undefined;

  const [low, high] = range;
  if (priceLevel === 1) return low;
  if (priceLevel === 2) return Math.round((low + high) / 2);
  if (priceLevel === 3) return high;
  return Math.round(high * 1.6);
}

/**
 * The 4 values in LODGING_PRICE_TIERS act as boundaries partitioning the
 * price axis into 4 contiguous tiers: [floor, t1], [t1, t2], [t2, t3],
 * [t3, ceiling] — floor/ceiling extrapolate below tier 1 and above tier 4
 * the same way estimateMealCost's priceLevel-4 case extrapolates past its
 * top reference point. priceLevel picks which tier's [low, high] to return.
 */
export function estimateLodgingCostRange(
  currency: string | undefined,
  priceLevel: number | null | undefined,
): [number, number] | undefined {
  if (!priceLevel || priceLevel < 1) return undefined;
  const tiers = currency ? LODGING_PRICE_TIERS[currency] : undefined;
  if (!tiers) return undefined;

  const idx = Math.min(Math.max(Math.round(priceLevel) - 1, 0), 3);
  const floor = Math.round(tiers[0] * 0.55);
  const ceiling = Math.round(tiers[3] * 1.6);
  const boundaries = [floor, tiers[0], tiers[1], tiers[2], ceiling];
  return [boundaries[idx], boundaries[idx + 1]];
}

export function estimateLodgingCostPerNight(
  currency: string | undefined,
  priceLevel: number | null | undefined,
): number | undefined {
  const range = estimateLodgingCostRange(currency, priceLevel);
  if (!range) return undefined;
  return Math.round((range[0] + range[1]) / 2);
}

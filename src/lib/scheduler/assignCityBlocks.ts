export type SightseeingBudgetInput = {
  targetDays: number;
  structuralDaysUsed: number;
  keptSightseeingDayCount: number;
  lockedAttractionCount: number;
};

export type SightseeingBudget = {
  cappedKeptSightseeingDayCount: number;
  extraAiSightseeingDaysNeeded: number;
};

/**
 * Splits a city's targetDays budget between kept sightseeing days and
 * brand-new AI-generated ones, after structural (transit/return) days and
 * full-day locked attractions have claimed their share. If more sightseeing
 * days were kept than the remaining budget allows (e.g. a stale client
 * selection from before targetDays was last lowered), the excess is
 * dropped rather than letting the city exceed its budget.
 */
export function computeSightseeingBudget(input: SightseeingBudgetInput): SightseeingBudget {
  const { targetDays, structuralDaysUsed, keptSightseeingDayCount, lockedAttractionCount } = input;

  const sightseeingCap = Math.max(0, targetDays - structuralDaysUsed - lockedAttractionCount);
  const cappedKeptSightseeingDayCount = Math.min(keptSightseeingDayCount, sightseeingCap);
  const extraAiSightseeingDaysNeeded = Math.max(
    0,
    targetDays - structuralDaysUsed - cappedKeptSightseeingDayCount - lockedAttractionCount
  );

  return { cappedKeptSightseeingDayCount, extraAiSightseeingDaysNeeded };
}

export type CityBlockInput = {
  name: string;
  isNew: boolean;
  targetDays: number;
  /** Non-structural days already kept from a previous version of this city's block. Always 0 for a new city. */
  keptSightseeingDayCount: number;
  /** Structural (transit/return) days already kept for this city, counted toward targetDays. Always 0 for a new city. */
  keptStructuralDayCount: number;
  lockedAttractionCount: number;
};

export type CityBlockPlan = {
  name: string;
  needsLeadingTransitDay: boolean;
  dropsStoredOutboundDay: boolean;
  cappedKeptSightseeingDayCount: number;
  extraAiSightseeingDaysNeeded: number;
};

/**
 * Plans each city's day-count allocation from the user-declared, already-
 * ordered final city list — the "天數/城市分配" piece of
 * plan/hybrid-rule-engine-scheduling.md section 3.1. City order itself
 * isn't decided here (the caller/user already fixed it); this only decides,
 * per city:
 * - whether it needs a freshly generated leading transit day (always true
 *   for a new city; true for an existing city only when the city right
 *   before it in the new order is itself new, since that neighbor didn't
 *   exist yet to have generated the connecting leg)
 * - whether its own previously-generated outbound transit day is now
 *   redundant (true when the city right after it is new, since that new
 *   city generates the same leg as its own leading-in day)
 * - how its remaining day budget splits between kept and new sightseeing
 *   days (via computeSightseeingBudget)
 *
 * Deliberately excludes LLM content generation, concrete Day objects, and
 * DB/trash-bin side effects — those stay in the restructure route for now
 * (see plan Phase 4 for wiring this module in later).
 */
export function planCityBlocks(cities: CityBlockInput[]): CityBlockPlan[] {
  return cities.map((city, index) => {
    const prevCity = cities[index - 1];
    const nextCity = cities[index + 1];

    const needsLeadingTransitDay = city.isNew || (prevCity?.isNew ?? false);
    const dropsStoredOutboundDay = !city.isNew && (nextCity?.isNew ?? false);

    const structuralDaysUsed = city.keptStructuralDayCount + (needsLeadingTransitDay ? 1 : 0);
    const budget = computeSightseeingBudget({
      targetDays: city.targetDays,
      structuralDaysUsed,
      keptSightseeingDayCount: city.keptSightseeingDayCount,
      lockedAttractionCount: city.lockedAttractionCount,
    });

    return {
      name: city.name,
      needsLeadingTransitDay,
      dropsStoredOutboundDay,
      ...budget,
    };
  });
}

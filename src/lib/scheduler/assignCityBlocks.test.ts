import { describe, expect, it } from "vitest";
import {
  computeSightseeingBudget,
  planCityBlocks,
  type CityBlockInput,
} from "@/lib/scheduler/assignCityBlocks";

describe("computeSightseeingBudget", () => {
  it("splits the remaining budget between kept and new sightseeing days", () => {
    const result = computeSightseeingBudget({
      targetDays: 5,
      structuralDaysUsed: 1,
      keptSightseeingDayCount: 2,
      lockedAttractionCount: 0,
    });
    expect(result).toEqual({ cappedKeptSightseeingDayCount: 2, extraAiSightseeingDaysNeeded: 2 });
  });

  it("truncates kept sightseeing days that exceed the budget instead of overshooting", () => {
    const result = computeSightseeingBudget({
      targetDays: 3,
      structuralDaysUsed: 1,
      keptSightseeingDayCount: 5,
      lockedAttractionCount: 0,
    });
    expect(result).toEqual({ cappedKeptSightseeingDayCount: 2, extraAiSightseeingDaysNeeded: 0 });
  });

  it("lets locked attractions eat into the remaining budget", () => {
    const result = computeSightseeingBudget({
      targetDays: 4,
      structuralDaysUsed: 1,
      keptSightseeingDayCount: 0,
      lockedAttractionCount: 2,
    });
    expect(result).toEqual({ cappedKeptSightseeingDayCount: 0, extraAiSightseeingDaysNeeded: 1 });
  });

  it("leaves nothing to allocate when structural days already fill the budget", () => {
    const result = computeSightseeingBudget({
      targetDays: 1,
      structuralDaysUsed: 1,
      keptSightseeingDayCount: 0,
      lockedAttractionCount: 0,
    });
    expect(result).toEqual({ cappedKeptSightseeingDayCount: 0, extraAiSightseeingDaysNeeded: 0 });
  });

  it("clamps to zero rather than going negative when structural + locked days overshoot targetDays", () => {
    const result = computeSightseeingBudget({
      targetDays: 1,
      structuralDaysUsed: 1,
      keptSightseeingDayCount: 0,
      lockedAttractionCount: 1,
    });
    expect(result).toEqual({ cappedKeptSightseeingDayCount: 0, extraAiSightseeingDaysNeeded: 0 });
  });
});

describe("planCityBlocks", () => {
  function city(overrides: Partial<CityBlockInput> & { name: string }): CityBlockInput {
    return {
      isNew: false,
      targetDays: 3,
      keptSightseeingDayCount: 0,
      keptStructuralDayCount: 0,
      lockedAttractionCount: 0,
      ...overrides,
    };
  }

  it("always gives a new city a leading transit day and never drops an outbound day it can't have", () => {
    const [plan] = planCityBlocks([city({ name: "Tokyo", isNew: true, targetDays: 4 })]);
    expect(plan.needsLeadingTransitDay).toBe(true);
    expect(plan.dropsStoredOutboundDay).toBe(false);
  });

  it("gives an existing city a leading transit day when the city right before it is new", () => {
    const [, existing] = planCityBlocks([
      city({ name: "Osaka", isNew: true, targetDays: 2 }),
      city({ name: "Kyoto", isNew: false, targetDays: 3, keptStructuralDayCount: 1 }),
    ]);
    expect(existing.needsLeadingTransitDay).toBe(true);
  });

  it("does not give an existing city a leading transit day when its predecessor is also existing", () => {
    const [, second] = planCityBlocks([
      city({ name: "Kyoto", isNew: false, targetDays: 3 }),
      city({ name: "Nara", isNew: false, targetDays: 2 }),
    ]);
    expect(second.needsLeadingTransitDay).toBe(false);
  });

  it("drops an existing city's stored outbound day when the next city is new", () => {
    const [first] = planCityBlocks([
      city({ name: "Kyoto", isNew: false, targetDays: 3, keptStructuralDayCount: 1 }),
      city({ name: "Nara", isNew: true, targetDays: 2 }),
    ]);
    expect(first.dropsStoredOutboundDay).toBe(true);
  });

  it("keeps an existing city's stored outbound day when the next city is also existing", () => {
    const [first] = planCityBlocks([
      city({ name: "Kyoto", isNew: false, targetDays: 3, keptStructuralDayCount: 1 }),
      city({ name: "Nara", isNew: false, targetDays: 2 }),
    ]);
    expect(first.dropsStoredOutboundDay).toBe(false);
  });

  it("produces a full, self-consistent plan across a mixed new/existing trip", () => {
    const plans = planCityBlocks([
      city({ name: "Tokyo", isNew: false, targetDays: 3, keptStructuralDayCount: 1, keptSightseeingDayCount: 2 }),
      city({ name: "Hakone", isNew: true, targetDays: 2, lockedAttractionCount: 1 }),
      city({ name: "Kyoto", isNew: false, targetDays: 4, keptStructuralDayCount: 1, keptSightseeingDayCount: 3 }),
    ]);

    expect(plans.map((p) => p.name)).toEqual(["Tokyo", "Hakone", "Kyoto"]);

    // Tokyo: next city (Hakone) is new, so its stored outbound day is redundant;
    // no predecessor, so it needs no leading transit day itself.
    expect(plans[0]).toMatchObject({
      needsLeadingTransitDay: false,
      dropsStoredOutboundDay: true,
      cappedKeptSightseeingDayCount: 2,
      extraAiSightseeingDaysNeeded: 0,
    });

    // Hakone: new city always gets a leading transit day (1 of its 2 targetDays),
    // leaving 1 day for its 1 locked attraction.
    expect(plans[1]).toMatchObject({
      needsLeadingTransitDay: true,
      dropsStoredOutboundDay: false,
      cappedKeptSightseeingDayCount: 0,
      extraAiSightseeingDaysNeeded: 0,
    });

    // Kyoto: predecessor (Hakone) is new, so it needs a fresh leading transit
    // day even though it already had 1 kept structural day (its return day).
    expect(plans[2]).toMatchObject({
      needsLeadingTransitDay: true,
      dropsStoredOutboundDay: false,
      cappedKeptSightseeingDayCount: 2,
      extraAiSightseeingDaysNeeded: 0,
    });
  });
});

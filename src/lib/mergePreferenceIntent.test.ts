import { describe, expect, it } from "vitest";
import { NEUTRAL_PREFERENCE_INTENT, type PreferenceIntent } from "@/lib/schemas";
import { mergePreferenceIntent } from "./mergePreferenceIntent";

const parsed = (overrides: Partial<PreferenceIntent>): PreferenceIntent => ({
  ...NEUTRAL_PREFERENCE_INTENT,
  ...overrides,
});

describe("mergePreferenceIntent", () => {
  it("returns the parsed intent unchanged when the form set nothing", () => {
    const fromText = parsed({ pace: "relaxed", avoid: ["crowds"], interestBoost: ["art"] });
    expect(mergePreferenceIntent(undefined, fromText)).toEqual(fromText);
  });

  it("lets the form's pace and start time win over free text", () => {
    const result = mergePreferenceIntent(
      { pace: "intensive", startTime: "late" },
      parsed({ pace: "relaxed", startTimePreference: "early" })
    );
    expect(result.pace).toBe("intensive");
    expect(result.startTimePreference).toBe("late");
  });

  it("falls back to free text for single-choice fields the form left unset", () => {
    const result = mergePreferenceIntent({ budget: "budget" }, parsed({ pace: "relaxed", startTimePreference: "early" }));
    expect(result.pace).toBe("relaxed");
    expect(result.startTimePreference).toBe("early");
  });

  it("unions interests and dietary restrictions without duplicates", () => {
    const result = mergePreferenceIntent(
      { interests: ["culture", "nature"], dietaryRestrictions: ["no_seafood"] },
      parsed({ interestBoost: ["nature", "art"], dietaryRestrictions: ["no_seafood", "no_spicy"] })
    );
    expect(result.interestBoost).toEqual(["culture", "nature", "art"]);
    expect(result.dietaryRestrictions).toEqual(["no_seafood", "no_spicy"]);
  });

  it("takes avoid from free text only", () => {
    expect(mergePreferenceIntent({ pace: "moderate" }, parsed({ avoid: ["long_walks"] })).avoid).toEqual(["long_walks"]);
  });
});

describe("mergePreferenceIntent — 室內行程為主", () => {
  it("carries the form's indoor-first choice to the scheduler", () => {
    expect(mergePreferenceIntent({ indoorFirst: true }, parsed({})).indoorFirst).toBe(true);
  });

  it("adds nothing when it wasn't chosen", () => {
    expect(mergePreferenceIntent({}, parsed({}))).not.toHaveProperty("indoorFirst");
  });
});

describe("mergePreferenceIntent — 交通方式", () => {
  it("marks a self-driver for the scheduler", () => {
    expect(mergePreferenceIntent({ transport: "drive" }, parsed({})).selfDrive).toBe(true);
    expect(mergePreferenceIntent({ transport: "transit" }, parsed({}))).not.toHaveProperty("selfDrive");
  });
});

describe("mergePreferenceIntent — 同行者 親子", () => {
  it("marks a trip with children and leads the themes with 親子同樂", () => {
    const merged = mergePreferenceIntent({ companions: ["kids"], interests: ["culture"] }, parsed({ interestBoost: ["art"] }));
    expect(merged.kids).toBe(true);
    expect(merged.interestBoost).toEqual(["kids", "culture", "art"]);
  });

  it("adds nothing without children", () => {
    expect(mergePreferenceIntent({}, parsed({}))).not.toHaveProperty("kids");
  });
});

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

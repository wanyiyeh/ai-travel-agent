import { describe, expect, it } from "vitest";
import { dayThemeKeys, interestWeightsOf, isOnTheme, popularSlots, themesOf } from "@/lib/dayThemes";

describe("themesOf", () => {
  it("maps form interests and free-text tags to themes, each once, in order", () => {
    expect(themesOf(["nature", "history", "art", "culture"])).toEqual(["nature", "culture"]);
  });

  it("ignores interests without a theme yet", () => {
    expect(themesOf(["adventure", "nightlife"])).toEqual([]);
  });
});

describe("dayThemeKeys", () => {
  it("rotates through the themes day by day", () => {
    expect(dayThemeKeys(["culture", "nature"], 3)).toEqual(["culture", "nature", "culture"]);
  });

  it("continues the rotation from firstIndex, so the next city doesn't restart it", () => {
    expect(dayThemeKeys(["culture", "nature"], 2, 3)).toEqual(["nature", "culture"]);
  });

  it("gives every day the one theme when only one was chosen", () => {
    expect(dayThemeKeys(["food"], 3)).toEqual(["food", "food", "food"]);
  });

  it("has no themes without interests", () => {
    expect(dayThemeKeys([], 2)).toEqual([undefined, undefined]);
  });
});

describe("popularSlots", () => {
  it("keeps about a third of a day for popular sights", () => {
    // intensive / moderate / relaxed day sizes
    expect([6, 3, 2].map(popularSlots)).toEqual([2, 1, 1]);
  });

  it("gives a one-stop day entirely to the theme", () => {
    expect(popularSlots(1)).toBe(0);
  });
});

describe("isOnTheme", () => {
  it("counts a temple as culture even though temples aren't searched for", () => {
    expect(isOnTheme(["buddhist_temple", "tourist_attraction"], "culture")).toBe(true);
  });

  it("doesn't count a park as culture", () => {
    expect(isOnTheme(["park", "tourist_attraction"], "culture")).toBe(false);
  });
});

describe("interestWeightsOf", () => {
  it("boosts the theme's categories for days without a theme of their own", () => {
    expect(interestWeightsOf(["nature"])).toEqual({ park: 1.5, viewpoint: 1.5 });
  });
});

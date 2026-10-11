import { describe, expect, it } from "vitest";
import { THEMES, dayThemeKeys, interestWeightsOf, isCoreOfTheme, isOnTheme, popularSlots, themesOf } from "@/lib/dayThemes";

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

  it("skips days with a title of their own, so a day trip doesn't use up a theme", () => {
    expect(dayThemeKeys(["culture", "nature"], 3, 0, new Set([1]))).toEqual(["culture", undefined, "nature"]);
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

describe("親子同樂", () => {
  it("is a theme of its own, from the kids tag", () => {
    expect(themesOf(["kids", "culture"])).toEqual(["kids", "culture"]);
    expect(isOnTheme(["aquarium", "tourist_attraction"], "kids")).toBe(true);
    expect(isOnTheme(["museum"], "kids")).toBe(false);
  });
});

describe("老街巡禮", () => {
  it("is a theme searched by text and known by name, Google having no type for it", () => {
    expect(themesOf(["old_street"])).toEqual(["old_street"]);
    expect(isOnTheme(["tourist_attraction"], "old_street", "安平老街")).toBe(true);
    expect(isOnTheme(["tourist_attraction"], "old_street", "赤崁樓")).toBe(false);
  });
});

describe("毛孩同樂", () => {
  it("is the 寵物 theme, with dog parks and dog cafés", () => {
    expect(themesOf(["pets"])).toEqual(["pets"]);
    expect(isOnTheme(["dog_cafe", "cafe"], "pets")).toBe(true);
    expect(isOnTheme(["park"], "pets")).toBe(false);
  });
});

describe("isCoreOfTheme", () => {
  // As the culture search around 東京駅 returned them.
  it("goes by a place's first type that says anything", () => {
    expect(isCoreOfTheme(["tourist_attraction", "art_museum", "museum"], "culture")).toBe(true); // 東京國立博物館
    expect(isCoreOfTheme(["castle", "tourist_attraction", "historical_place"], "culture")).toBe(true); // 皇居
    expect(isCoreOfTheme(["observation_deck", "landmark", "tourist_attraction", "historical_landmark"], "culture")).toBe(false); // 東京鐵塔
    expect(isCoreOfTheme(["tourist_attraction", "amusement_park", "art_museum"], "culture")).toBe(false); // teamLab Planets
  });

  it("doesn't start a 自然漫遊 day at a tower", () => {
    expect(isCoreOfTheme(["observation_deck", "tourist_attraction", "landmark"], "nature")).toBe(false); // 東京鐵塔
    expect(isCoreOfTheme(["garden", "tourist_attraction", "state_park"], "nature")).toBe(true); // 新宿御苑
  });

  it("knows a 老街 by its name", () => {
    expect(isCoreOfTheme(["tourist_attraction"], "old_street", "安平老街")).toBe(true);
  });
});

describe("購物散策", () => {
  it("is malls and department stores, plus shopping streets, select shops, districts and outlets — no supermarkets or markets", () => {
    expect(THEMES.shopping.searchTypes).toEqual(["shopping_mall", "department_store"]);
    expect(THEMES.shopping.textSearches?.("東京", false).map((t) => t.query)).toEqual([
      "東京 商店街",
      "東京 選物店",
      "東京 購物商圈",
      "東京 outlet",
    ]);
    expect(THEMES.shopping.textSearches?.("東京", false).at(-1)?.km).toBe(30);
    expect(isOnTheme(["supermarket"], "shopping")).toBe(false);
  });

  it("knows a shopping street by its name", () => {
    expect(isOnTheme(["tourist_attraction"], "shopping", "谷中銀座商店街")).toBe(true);
    expect(isCoreOfTheme(["tourist_attraction"], "shopping", "谷中銀座商店街")).toBe(true);
  });
});


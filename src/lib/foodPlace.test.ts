import { describe, expect, it } from "vitest";
import { isFoodPlace } from "./foodPlace";

// Type lists below are real cached Nearby Search results (新宿, breakfast query).
describe("isFoodPlace", () => {
  it.each([
    ["新宿高島屋", ["department_store", "sportswear_store", "cafe"]],
    ["TOHO影城 新宿", ["movie_theater", "shopping_mall", "cafe"]],
    ["LUMINE EST", ["shopping_mall", "cosmetics_store", "cafe"]],
    ["小田急世紀南悅酒店", ["hotel", "western_restaurant", "cafe"]],
    ["ME TOKYO", ["video_arcade", "amusement_center", "cafe"]],
  ])("rejects %s", (_name, types) => {
    expect(isFoodPlace({ types })).toBe(false);
  });

  it.each([
    ["Fuglen Tokyo", ["coffee_shop", "cocktail_bar", "cafe"]],
    ["麥當勞", ["fast_food_restaurant", "cafeteria", "cafe"]],
    ["I'm donut?", ["donut_shop", "bakery"]],
    ["Flipper's", ["brunch_restaurant", "cafe"]],
    ["Cafe Aaliya", ["cafe", "food"]],
    ["NUMBER SUGAR", ["pastry_shop", "dessert_shop", "bakery"]],
  ])("keeps %s", (_name, types) => {
    expect(isFoodPlace({ types })).toBe(true);
  });

  it("keeps places with no type data", () => {
    expect(isFoodPlace({})).toBe(true);
    expect(isFoodPlace({ types: [] })).toBe(true);
  });
});

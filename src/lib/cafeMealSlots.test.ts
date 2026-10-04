import { describe, expect, it } from "vitest";
import { fitsCafeMealSlot, fitsMainMeal, splitCafePool } from "./cafeMealSlots";

const at = (name: string, primary?: string) => ({ name, types: primary ? [primary, "food"] : undefined });

describe("fitsCafeMealSlot", () => {
  it("keeps breakfast-only and snack-only places to their own slot", () => {
    expect(fitsCafeMealSlot(at("Teishoku", "breakfast_restaurant"), "snack")).toBe(false);
    expect(fitsCafeMealSlot(at("Gelato", "ice_cream_shop"), "breakfast")).toBe(false);
  });

  it("lets a café, a bakery, or a place without types serve either", () => {
    for (const place of [at("Cafe", "cafe"), at("Bakery", "bakery"), at("Unknown")]) {
      expect(fitsCafeMealSlot(place, "breakfast")).toBe(true);
      expect(fitsCafeMealSlot(place, "snack")).toBe(true);
    }
  });
});

describe("slot-appropriate types", () => {
  it("keeps full restaurants out of breakfast and snack, except breakfast/brunch and dessert places", () => {
    expect(fitsCafeMealSlot(at("Curry Diner", "japanese_curry_restaurant"), "snack")).toBe(false);
    expect(fitsCafeMealSlot(at("Curry Diner", "japanese_curry_restaurant"), "breakfast")).toBe(false);
    expect(fitsCafeMealSlot(at("Brunch", "brunch_restaurant"), "breakfast")).toBe(true);
    expect(fitsCafeMealSlot(at("Zenzai", "dessert_restaurant"), "snack")).toBe(true);
  });

  it("keeps sweets and coffee out of lunch and dinner", () => {
    expect(fitsMainMeal(at("Shaved Ice", "dessert_restaurant"))).toBe(false);
    expect(fitsMainMeal(at("Cafe", "cafe"))).toBe(false);
    expect(fitsMainMeal(at("Ramen", "ramen_restaurant"))).toBe(true);
    expect(fitsMainMeal(at("Unknown"))).toBe(true);
  });
});

describe("splitCafePool", () => {
  it("never offers the same place for both meals, alternating the shared ones", () => {
    const pool = [at("Cafe 1", "cafe"), at("Gelato", "ice_cream_shop"), at("Cafe 2", "cafe"), at("Brunch", "brunch_restaurant"), at("Bakery", "bakery")];
    const { breakfast, snack } = splitCafePool(pool, 2);

    expect(breakfast.map((p) => p.name)).toEqual(["Cafe 1", "Brunch", "Bakery"]);
    expect(snack.map((p) => p.name)).toEqual(["Gelato", "Cafe 2"]);
  });

  it("lets both meals share the suitable places when splitting would run a long stay short", () => {
    const pool = [at("Cafe 1", "cafe"), at("Gelato", "ice_cream_shop"), at("Cafe 2", "cafe"), at("Brunch", "brunch_restaurant")];
    // 3 days need 3 snacks; a split would leave only Gelato + one café
    const { breakfast, snack } = splitCafePool(pool, 3);

    expect(breakfast.map((p) => p.name)).toEqual(["Cafe 1", "Cafe 2", "Brunch"]);
    expect(snack.map((p) => p.name)).toEqual(["Cafe 1", "Gelato", "Cafe 2"]);
  });
});

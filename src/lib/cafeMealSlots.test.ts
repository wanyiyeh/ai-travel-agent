import { describe, expect, it } from "vitest";
import { fitsCafeMealSlot, splitCafePool } from "./cafeMealSlots";

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

describe("splitCafePool", () => {
  it("never offers the same place for both meals, alternating the shared ones", () => {
    const pool = [at("Cafe 1", "cafe"), at("Gelato", "ice_cream_shop"), at("Cafe 2", "cafe"), at("Brunch", "brunch_restaurant"), at("Bakery", "bakery")];
    const { breakfast, snack } = splitCafePool(pool);

    expect(breakfast.map((p) => p.name)).toEqual(["Cafe 1", "Brunch", "Bakery"]);
    expect(snack.map((p) => p.name)).toEqual(["Gelato", "Cafe 2"]);
  });
});

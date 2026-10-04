import { describe, expect, it } from "vitest";
import { isLuxuryBrand, isLuxuryLodging, rankLodgingByBudget } from "./lodgingTiers";

describe("isLuxuryBrand", () => {
  it("matches international brands in English and in their Chinese names", () => {
    expect(isLuxuryBrand("Hilton Tokyo")).toBe(true);
    expect(isLuxuryBrand("東京希爾頓酒店")).toBe(true);
    expect(isLuxuryBrand("京都麗思卡爾頓酒店")).toBe(true);
    expect(isLuxuryBrand("The Westin Osaka")).toBe(true);
  });

  it("does not match ordinary or business hotels", () => {
    expect(isLuxuryBrand("東橫INN 京都四條烏丸")).toBe(false);
    expect(isLuxuryBrand("APA Hotel Shinjuku")).toBe(false);
  });

  it("does not match brand names that only appear inside another word", () => {
    expect(isLuxuryBrand("Hotel Yamanote")).toBe(false); // contains "aman"
    expect(isLuxuryBrand("New Hotel Kyoto")).toBe(false);
    expect(isLuxuryBrand("四季の宿 旅館")).toBe(false); // 四季 is an ordinary word
    expect(isLuxuryBrand("伊豆半島民宿")).toBe(false);
    expect(isLuxuryBrand("Aman Tokyo")).toBe(true);
    expect(isLuxuryBrand("東京四季酒店")).toBe(true);
  });
});

describe("isLuxuryLodging", () => {
  it("also counts a place whose primary type is resort_hotel", () => {
    expect(isLuxuryLodging({ name: "Some Beach Resort", types: ["resort_hotel", "lodging"] })).toBe(true);
    expect(isLuxuryLodging({ name: "Some Hotel", types: ["hotel", "resort_hotel"] })).toBe(false);
  });
});

describe("rankLodgingByBudget", () => {
  const pool = [
    { name: "東橫INN", types: ["hotel"] },
    { name: "Backpackers Hostel", types: ["hostel", "lodging"] },
    { name: "Park Hyatt", types: ["hotel"] },
  ];

  it("budget: hostels first, keeping the rest in popularity order", () => {
    expect(rankLodgingByBudget(pool, "budget").map((p) => p.name)).toEqual(["Backpackers Hostel", "東橫INN", "Park Hyatt"]);
  });

  it("luxury: brand hotels first", () => {
    expect(rankLodgingByBudget(pool, "luxury").map((p) => p.name)).toEqual(["Park Hyatt", "東橫INN", "Backpackers Hostel"]);
  });

  it("moderate and no budget: unchanged", () => {
    expect(rankLodgingByBudget(pool, "moderate")).toBe(pool);
    expect(rankLodgingByBudget(pool, undefined)).toBe(pool);
  });
});

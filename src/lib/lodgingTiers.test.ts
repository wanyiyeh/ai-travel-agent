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
    // a later whole-word occurrence still counts after an in-word one
    expect(isLuxuryBrand("Yamanote Aman Suites")).toBe(true);
    // punctuation in a brand name is matched literally, not as a pattern
    expect(isLuxuryBrand("The St. Regis Osaka")).toBe(true);
    expect(isLuxuryBrand("St Xregis Inn")).toBe(false);
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
  const hostel = (n: number) => ({ name: `Hostel ${n}`, types: ["hostel", "lodging"] });
  const business = (n: number) => ({ name: `Business Hotel ${n}`, types: ["hotel"] });
  const lux = (n: number) => ({ name: `Hilton ${n}`, types: ["hotel"] });

  it("budget: keeps only hostels when there are enough of them", () => {
    const pool = [lux(1), hostel(1), business(1), hostel(2), hostel(3)];
    expect(rankLodgingByBudget(pool, "budget").map((p) => p.name)).toEqual(["Hostel 1", "Hostel 2", "Hostel 3"]);
  });

  it("budget: with too few hostels, puts them first but keeps the rest", () => {
    const pool = [lux(1), hostel(1), business(1)];
    expect(rankLodgingByBudget(pool, "budget").map((p) => p.name)).toEqual(["Hostel 1", "Hilton 1", "Business Hotel 1"]);
  });

  it("moderate: drops luxury brands that the hotel search also returns", () => {
    const pool = [lux(1), business(1), business(2), hostel(1)];
    expect(rankLodgingByBudget(pool, "moderate").map((p) => p.name)).toEqual(["Business Hotel 1", "Business Hotel 2", "Hostel 1"]);
  });

  it("luxury: keeps only brand hotels when there are enough of them", () => {
    const pool = [business(1), lux(1), lux(2), lux(3)];
    expect(rankLodgingByBudget(pool, "luxury").map((p) => p.name)).toEqual(["Hilton 1", "Hilton 2", "Hilton 3"]);
  });

  it("no budget: unchanged", () => {
    const pool = [lux(1), hostel(1)];
    expect(rankLodgingByBudget(pool, undefined)).toBe(pool);
  });
});

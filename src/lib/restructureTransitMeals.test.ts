import { describe, expect, it } from "vitest";
import { fillTransitMeals } from "@/lib/restructureTransitMeals";

const meal = (name: string) => ({ name, placeId: `p-${name}` });

// 東京 → 京都 replaced by 東京 → 名古屋 → 京都.
const oldLeg = {
  id: "old",
  isTransitDay: true,
  waypointCity: "東京",
  transitTo: "京都",
  meals: { breakfast: meal("東京早餐"), lunch: meal("京都午餐"), snack: meal("京都點心"), dinner: meal("京都晚餐") },
};
const intoNagoya = { id: "n1", isTransitDay: true, waypointCity: "東京", transitTo: "名古屋", meals: { lunch: meal("名古屋午餐") } };
const intoKyoto = { id: "n2", isTransitDay: true, waypointCity: "名古屋", transitTo: "京都", meals: {} };
const kyotoDay = { id: "k1", waypointCity: "京都", meals: { lunch: meal("京都別家") } };

describe("fillTransitMeals", () => {
  it("gives the replaced day's breakfast to the day leaving the same city, and its other meals to the day arriving in the same one", () => {
    const [nagoya, kyoto] = fillTransitMeals([intoNagoya, intoKyoto], [oldLeg]);
    expect(nagoya.meals).toEqual({ breakfast: meal("東京早餐"), lunch: meal("名古屋午餐") });
    expect(kyoto.meals).toEqual({ lunch: meal("京都午餐"), snack: meal("京都點心"), dinner: meal("京都晚餐") });
  });

  it("takes the breakfast before leaving a new city from its own picks", () => {
    const [, kyoto] = fillTransitMeals([intoNagoya, intoKyoto], [oldLeg], new Map([["名古屋", meal("名古屋早餐")]]));
    expect((kyoto.meals as Record<string, unknown>).breakfast).toEqual(meal("名古屋早餐"));
  });

  it("leaves a day that's still on the trip alone, and doesn't touch other days", () => {
    const days = fillTransitMeals([{ ...oldLeg, meals: {} }, kyotoDay], [oldLeg]);
    expect(days[0].meals).toEqual({});
    expect(days[1]).toBe(kyotoDay);
  });

  it("never replaces a meal, refills one the traveler deleted, or moves a booked event's meal", () => {
    const booked = { ...oldLeg, meals: { ...oldLeg.meals, dinner: { ...meal("宴會"), fixedEvent: { type: "dinner" } } } };
    const [kyoto] = fillTransitMeals(
      [{ ...intoKyoto, meals: { lunch: meal("自己挑的") }, skippedMeals: ["snack"] }],
      [booked]
    );
    expect(kyoto.meals).toEqual({ lunch: meal("自己挑的") });
  });

  it("uses each replaced day once", () => {
    const again = { ...intoNagoya, id: "n3" };
    const days = fillTransitMeals([intoNagoya, again], [oldLeg]);
    expect((days[0].meals as Record<string, unknown>).breakfast).toEqual(meal("東京早餐"));
    expect((days[1].meals as Record<string, unknown>).breakfast).toBeUndefined();
  });

  it("leaves an old transit day with no meals at all as it was", () => {
    const legacy = { id: "n4", isTransitDay: true, waypointCity: "東京", transitTo: "名古屋" };
    expect(fillTransitMeals([legacy], [oldLeg])[0]).toBe(legacy);
  });
});

import { describe, expect, it } from "vitest";
import { skipMeal, unskipMeal } from "./skippedMeals";

describe("skipMeal", () => {
  it("removes the meal, its position, and remembers it was deleted", () => {
    const day = { meals: { lunch: { name: "L" }, snack: { name: "S" } }, mealPositions: { lunch: 1, snack: 3, dinner: 3 } };
    expect(skipMeal(day, "snack")).toEqual({
      meals: { lunch: { name: "L" } },
      mealPositions: { lunch: 1, dinner: 3 },
      skippedMeals: ["snack"],
    });
  });

  it("lists a meal only once", () => {
    expect(skipMeal({ skippedMeals: ["snack"] }, "snack").skippedMeals).toEqual(["snack"]);
  });
});

describe("unskipMeal", () => {
  it("brings the meal back as an empty slot", () => {
    expect(unskipMeal({ skippedMeals: ["snack", "nightcap"] }, "snack").skippedMeals).toEqual(["nightcap"]);
  });

  it("leaves a day that never deleted it as it was", () => {
    const day = { meals: {} };
    expect(unskipMeal(day, "lunch")).toBe(day);
  });
});

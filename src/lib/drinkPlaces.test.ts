import { describe, expect, it } from "vitest";
import { interleave, selectDrinkPlaces } from "@/lib/drinkPlaces";

const cafe = (name: string, type = "coffee_shop") => ({ name, placeId: name, types: [type, "cafe"] });

describe("selectDrinkPlaces", () => {
  it("drops chains found in every city, but keeps a Starbucks Reserve Roastery", () => {
    const kept = selectDrinkPlaces(
      [cafe("Starbucks Coffee 渋谷店"), cafe("路易莎咖啡"), cafe("STARBUCKS RESERVE ROASTERY TOKYO"), cafe("Glitch Coffee")],
      "coffee"
    );
    expect(kept.map((p) => p.name)).toEqual(["STARBUCKS RESERVE ROASTERY TOKYO", "Glitch Coffee"]);
  });

  // Story: some travelers seek out a local chain (Komeda in Nagoya), but the
  // same chain shouldn't be recommended twice.
  it("keeps one branch of a local chain", () => {
    const kept = selectDrinkPlaces(
      [cafe("コメダ珈琲店 名駅店"), cafe("Komeda's Coffee 栄店"), cafe("ドトールコーヒー"), cafe("Doutor 新宿")],
      "coffee"
    );
    expect(kept.map((p) => p.name)).toEqual(["コメダ珈琲店 名駅店", "ドトールコーヒー"]);
  });

  it("keeps a matcha search to places for a drink or a sweet, not a full restaurant", () => {
    const kept = selectDrinkPlaces(
      [cafe("中村藤吉", "tea_house"), cafe("抹茶甘味処", "dessert_shop"), cafe("抹茶そば 割烹", "japanese_restaurant")],
      "tea"
    );
    expect(kept.map((p) => p.name)).toEqual(["中村藤吉", "抹茶甘味処"]);
  });

  it("doesn't take a tea house as a coffee place", () => {
    expect(selectDrinkPlaces([cafe("Tea House", "tea_house")], "coffee")).toEqual([]);
  });
});

describe("interleave", () => {
  it("takes one from each list in turn, each place once", () => {
    const a = [{ placeId: "c1" }, { placeId: "c2" }, { placeId: "both" }];
    const b = [{ placeId: "t1" }, { placeId: "both" }];
    expect(interleave([a, b]).map((p) => p.placeId)).toEqual(["c1", "t1", "c2", "both"]);
  });
});

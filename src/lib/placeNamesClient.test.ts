import { describe, expect, it } from "vitest";
import { collectPlaceNames, daysMissingNames, withPlaceNames } from "@/lib/placeNamesClient";

// Day 1 as the server sent it (names filled), day 2 still with place IDs only.
const days = [
  { day: 1, stops: [{ id: "a", name: "淺草寺", address: "台東區", placeId: "p1" }] },
  {
    day: 2,
    stops: [{ id: "b", placeId: "p2", description: "我們寫的介紹" }, { id: "c", name: "搭電車", description: "" }],
    meals: { lunch: { placeId: "p3" } },
    accommodation: { area: "新宿", placeId: "p4" },
  },
];

describe("daysMissingNames", () => {
  it("lists the days with a place still waiting for its name", () => {
    expect(daysMissingNames(days)).toEqual([2]);
  });
});

describe("collectPlaceNames", () => {
  it("remembers the names the server filled in, by place ID", () => {
    expect(collectPlaceNames(days)).toEqual({ p1: { name: "淺草寺", address: "台東區" } });
  });
});

describe("withPlaceNames", () => {
  const book = { p2: { name: "東京晴空塔", address: "墨田區" }, p3: { name: "大黑家" }, p4: { name: "新宿格拉斯麗飯店" } };

  it("fills every place the book knows, keeping our own fields", () => {
    const [, day2] = withPlaceNames(days, book) as typeof days;
    expect(day2.stops[0]).toEqual({ id: "b", placeId: "p2", description: "我們寫的介紹", name: "東京晴空塔", address: "墨田區" });
    expect(day2.meals!.lunch).toMatchObject({ name: "大黑家" });
    expect(day2.accommodation).toMatchObject({ name: "新宿格拉斯麗飯店", area: "新宿" });
    expect(daysMissingNames(withPlaceNames(days, book))).toEqual([]);
  });

  it("leaves a day with nothing to fill as the same object, so edits in state aren't replaced", () => {
    const filled = withPlaceNames(days, book);
    expect(filled[0]).toBe(days[0]);
  });

  it("never overwrites a name that's already there", () => {
    const [day1] = withPlaceNames(days, { p1: { name: "別的名字" } }) as typeof days;
    expect(day1.stops[0].name).toBe("淺草寺");
  });
});

import { describe, expect, it } from "vitest";
import { CURATED_OPTIONS, mergeAirportOptions, searchAirports, type AirportOption } from "@/lib/airportOptions";

const options: AirportOption[] = [
  { code: "NRT", name: "東京", country: "日本" },
  { code: "LIM", name: "利馬", nameEn: "Lima", country: "秘魯" },
  { code: "GRU", name: "聖保羅", nameEn: "São Paulo", country: "巴西" },
  { code: "BHX", name: "伯明罕", nameEn: "Birmingham", country: "英國" },
  { code: "BHM", name: "伯明罕", nameEn: "Birmingham", country: "美國" },
  { code: "SLM", name: "Salamanca", nameEn: "Salamanca", country: "西班牙" },
];
const codes = (query: string) => searchAirports(options, query, 10).map((o) => o.code);

describe("searchAirports", () => {
  // PLAN-003: 「LIM」, 「Lima」 and 「利馬」 all find Lima.
  it("finds an airport by code, Chinese name or English name", () => {
    expect(codes("LIM")).toEqual(["LIM"]);
    expect(codes("lima")).toEqual(["LIM"]);
    expect(codes("利馬")).toEqual(["LIM"]);
  });

  it("ignores accents and case", () => {
    expect(codes("sao paulo")).toEqual(["GRU"]);
  });

  it("puts the code first, then names that start with the text, then ones that contain it", () => {
    // "sal": Salamanca starts with it; nothing else has it
    expect(codes("sal")).toEqual(["SLM"]);
    // "LIM" is Lima's code; Salamanca has no "lim" — only Lima comes back
    expect(codes("lim")).toEqual(["LIM"]);
  });

  it("lists both of two cities with one name, each with its country", () => {
    expect(searchAirports(options, "伯明罕", 10).map((o) => `${o.name} ${o.country}`)).toEqual(["伯明罕 英國", "伯明罕 美國"]);
  });

  it("finds a country's airports by the country's name", () => {
    expect(codes("秘魯")).toEqual(["LIM"]);
  });

  it("shows the first few when nothing is typed", () => {
    expect(searchAirports(options, "  ", 2).map((o) => o.code)).toEqual(["NRT", "LIM"]);
  });
});

describe("mergeAirportOptions", () => {
  // Searching "reykjav" missed KEF: the hand-kept airports had no English name.
  it("gives hand-kept airports the English name, keeping their own name and country", () => {
    const curated = [{ code: "KEF", name: "雷克雅維克", country: "冰島" }];
    const full = [
      { code: "KEF", name: "凱夫拉維克", nameEn: "Keflavík", country: "冰島" },
      { code: "RKV", name: "雷克雅維克", nameEn: "Reykjavík", country: "冰島" },
    ];
    expect(mergeAirportOptions(curated, full)).toEqual([
      { code: "KEF", name: "雷克雅維克", nameEn: "Keflavík", country: "冰島" },
      { code: "RKV", name: "雷克雅維克", nameEn: "Reykjavík", country: "冰島" },
    ]);
  });
});

describe("CURATED_OPTIONS", () => {
  // #306: an airport with no flights left isn't offered; trips saved with it still read.
  it("offers Cambodia's new airports, not the closed ones", () => {
    const cambodia = CURATED_OPTIONS.filter((o) => o.country === "柬埔寨").map((o) => o.code);
    expect(cambodia.sort()).toEqual(["KTI", "SAI"]);
  });
});

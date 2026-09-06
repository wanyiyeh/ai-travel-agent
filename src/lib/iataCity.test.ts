import { describe, expect, it } from "vitest";
import { IATA_CITY_ZH, cityToIata, iataToCity } from "@/lib/iataCity";

describe("iataToCity", () => {
  it("maps a known IATA code to its Traditional Chinese city name", () => {
    expect(iataToCity("NRT")).toBe("東京");
    expect(iataToCity("TPE")).toBe("台北");
  });

  it("falls back to the raw code when unknown", () => {
    expect(iataToCity("ZZZ")).toBe("ZZZ");
  });
});

describe("cityToIata", () => {
  it("round-trips every code in IATA_CITY_ZH back to a code for the same city", () => {
    for (const [code, name] of Object.entries(IATA_CITY_ZH)) {
      const resolved = cityToIata(name);
      expect(resolved).toBeDefined();
      // Multiple codes can share a city (NRT/HND -> 東京); only the mapping
      // back to the *same city name* has to hold, not the exact original code.
      expect(iataToCity(resolved!)).toBe(name);
      void code;
    }
  });

  it("returns undefined for a city name with no known IATA code", () => {
    expect(cityToIata("不存在的城市")).toBeUndefined();
  });

  it("is the inverse of iataToCity for a simple single-code city", () => {
    expect(cityToIata(iataToCity("KIX"))).toBe("KIX");
  });
});

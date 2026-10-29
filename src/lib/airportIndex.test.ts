import { describe, expect, it } from "vitest";
import { AIRPORTS } from "@/lib/airports";
import { IATA_COUNTRY_ZH } from "@/lib/iataCountry";
import { cityToIata, countryNameOf, currencyOf, getIataCoords, iataToCity, lookupAirport } from "@/lib/airportIndex";

describe("lookupAirport", () => {
  // PLAN-003: the hand-kept table stays as it was, the generated data only adds.
  it("keeps every hand-kept airport's city, centre and country as they were", () => {
    for (const [code, airport] of Object.entries(AIRPORTS)) {
      expect(iataToCity(code)).toBe(airport.cityZh);
      expect(getIataCoords(code)).toEqual({ lat: airport.lat, lng: airport.lng });
      if (!airport.domestic) expect(countryNameOf(code)).toBe(IATA_COUNTRY_ZH[code]);
    }
  });

  it("gives every airport abroad a country and a currency", () => {
    const abroad = Object.entries(AIRPORTS).filter(([, a]) => !a.domestic).map(([code]) => code);
    expect(abroad.filter((code) => !lookupAirport(code)?.country || !currencyOf(code))).toEqual([]);
  });

  // Story: a friend couldn't find Lima, or anywhere in South America.
  it("finds an airport beyond the hand-kept list", () => {
    expect(lookupAirport("LIM")).toMatchObject({ cityZh: "利馬", cityEn: "Lima", country: "PE", countryZh: "秘魯", currency: "PEN", curated: false });
    expect(lookupAirport("LIM")?.priceLevel).toBeGreaterThan(0);
  });

  it("anchors on the city, not the airport", () => {
    const lim = lookupAirport("LIM")!;
    // Jorge Chávez is at -12.02, -77.11; Lima's centre is east of it
    expect(lim.lng).toBeGreaterThan(-77.1);
  });

  it("pays in dollars in Cambodia, at the old airports and the new", () => {
    expect(currencyOf("REP")).toBe("USD");
    expect(currencyOf("SAI")).toBe("USD");
  });

  // Searching "reykjavik" missed KEF: the generated name is the town it's in.
  it("uses the hand-kept English name where the generated one is a region or a town", () => {
    expect(lookupAirport("KEF")?.cityEn).toBe("Reykjavík");
    expect(lookupAirport("TPE")?.cityEn).toBe("Taipei");
    expect(lookupAirport("NRT")?.cityEn).toBe("Tokyo");
  });

  it("knows nothing of a code that isn't an airport", () => {
    expect(lookupAirport("XXX")).toBeUndefined();
    expect(iataToCity("XXX")).toBe("XXX");
    expect(getIataCoords("XXX")).toBeNull();
  });

  it("has no country for a place in Taiwan, which is a domestic trip", () => {
    expect(lookupAirport("TW-TNN")).toMatchObject({ curated: true });
    expect(lookupAirport("TW-TNN")?.country).toBeUndefined();
  });
});

describe("cityToIata", () => {
  it("prefers the hand-kept airport for its city", () => {
    expect(cityToIata("東京")).toBe("NRT");
  });

  it("maps a generated city to its airport", () => {
    expect(cityToIata("利馬")).toBe("LIM");
  });

  it("doesn't guess between two countries' cities of the same name", () => {
    // Birmingham, England and Birmingham, Alabama
    expect(cityToIata("伯明罕")).toBeUndefined();
  });
});

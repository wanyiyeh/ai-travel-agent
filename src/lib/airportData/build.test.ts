import { describe, expect, it } from "vitest";
import { buildAirportData, ourAirportsFrom, parseCsv, priceLevelsFrom, type OurAirport } from "./build";

describe("parseCsv", () => {
  it("handles quoted commas, doubled quotes and newlines", () => {
    expect(parseCsv('a,"b, c","say ""hi""","x\ny"\r\n1,2,3,4\n')).toEqual([
      ["a", "b, c", 'say "hi"', "x\ny"],
      ["1", "2", "3", "4"],
    ]);
  });
});

describe("ourAirportsFrom", () => {
  const header = "id,type,name,latitude_deg,longitude_deg,iso_country,municipality,scheduled_service,iata_code";
  it("keeps large and medium airports with scheduled flights and an IATA code", () => {
    const csv = [
      header,
      '1,large_airport,"Keflavik",63.985,-22.6056,IS,Reykjavík,yes,KEF',
      "2,small_airport,Tiny,1,1,IS,Somewhere,yes,TNY",
      "3,medium_airport,No flights,1,1,IS,Somewhere,no,NOF",
      "4,medium_airport,No code,1,1,IS,Somewhere,yes,",
    ].join("\n");
    expect(ourAirportsFrom(csv)).toEqual([
      { iata: "KEF", type: "large_airport", name: "Keflavik", municipality: "Reykjavík", country: "IS", lat: 63.985, lng: -22.6056 },
    ]);
  });

  it("stops when a column it needs is gone", () => {
    expect(() => ourAirportsFrom("id,type\n1,large_airport")).toThrow(/scheduled_service/);
  });
});

describe("priceLevelsFrom", () => {
  it("divides the PPP factor by the exchange rate, skipping countries missing either", () => {
    // 2025: Iceland 151.37 ISK per international $, 128.44 ISK per US$
    expect(priceLevelsFrom({ IS: 151.367985, JP: 97.08005, KP: 1 }, { IS: 128.44148705495, JP: 149.657926890951 })).toEqual({
      IS: 1.178,
      JP: 0.649,
    });
  });
});

describe("buildAirportData", () => {
  const kef: OurAirport = { iata: "KEF", type: "large_airport", name: "Keflavik", municipality: "Reykjavík", country: "IS", lat: 63.985, lng: -22.6056 };
  const lim: OurAirport = { iata: "LIM", type: "large_airport", name: "Jorge Chávez", municipality: "Lima", country: "PE", lat: -12.0219, lng: -77.1143 };
  const countries = [
    { iso2: "IS", labels: { "zh-tw": "冰島", en: "Iceland" }, currencies: ["ISK"] },
    { iso2: "PE", labels: { en: "Peru" }, currencies: ["PEN", "USD"] },
  ];

  it("names the city in Traditional Chinese and anchors on its centre, not the airport", () => {
    const { airports } = buildAirportData(
      [kef],
      [{ iata: "KEF", labels: { "zh-tw": "雷克雅維克", en: "Reykjavík" }, lat: 64.1466, lng: -21.9426 }],
      countries,
      { IS: 1.4 }
    );
    expect(airports.KEF).toEqual({ city: "雷克雅維克", cityEn: "Reykjavík", country: "IS", lat: 64.1466, lng: -21.9426, airportLat: 63.985, airportLng: -22.6056 });
  });

  it("falls back to English, and to the airport's place, when Wikidata knows less", () => {
    const { airports, report } = buildAirportData([lim], [{ iata: "LIM", labels: { en: "Lima" }, lat: -12.06, lng: -77.04 }], countries, {});
    expect(airports.LIM).toMatchObject({ city: "Lima", cityEn: "Lima", lat: -12.06 });
    expect(report.withChineseName).toBe(0);

    const none = buildAirportData([lim], [], countries, {});
    expect(none.airports.LIM).toMatchObject({ city: "Lima", lat: -12.0219, lng: -77.1143 });
    expect(none.report.noCity).toEqual(["LIM"]);
  });

  it("drops a served city too far from the airport", () => {
    const { airports, report } = buildAirportData([kef], [{ iata: "KEF", labels: { "zh-tw": "倫敦", en: "London" }, lat: 51.5, lng: -0.12 }], countries, {});
    expect(airports.KEF).toMatchObject({ city: "Reykjavík", lat: 63.985 });
    expect(report.farCities[0]).toMatchObject({ iata: "KEF", city: "London" });
  });

  it("gives each country its name, currency and price level, and reports what's missing", () => {
    const { countries: out, report } = buildAirportData([kef, lim], [], countries, { IS: 1.4 }, { PE: "PEN" });
    expect(out).toEqual({ IS: { name: "冰島", currency: "ISK", priceLevel: 1.4 }, PE: { name: "Peru", currency: "PEN" } });
    expect(report.countriesWithoutPriceLevel).toEqual(["PE"]);
    expect(report.severalCurrencies).toEqual([{ country: "PE", currencies: ["PEN", "USD"], picked: "PEN" }]);
  });

  it("keeps the dollar rate in the currency picked, 1 where that's the dollar", () => {
    const kh = [
      { iso2: "IS", labels: {}, currencies: ["ISK"] },
      { iso2: "KH", labels: {}, currencies: ["KHR"] },
    ];
    const pnh: OurAirport = { iata: "KTI", type: "large_airport", name: "Techo", municipality: "Phnom Penh", country: "KH", lat: 11.4, lng: 104.9 };
    const out = buildAirportData([kef, pnh], [], kh, {}, { KH: "USD" }, { IS: 128.4, KH: 4050 }).countries;
    expect(out.IS.perDollar).toBe(128.4);
    expect(out.KH).toMatchObject({ currency: "USD", perDollar: 1 });
  });

  it("ignores numeric currency codes", () => {
    const cz = [{ iso2: "IS", labels: {}, currencies: ["352", "ISK"] }];
    expect(buildAirportData([kef], [], cz, {}).countries.IS.currency).toBe("ISK");
  });

  it("prefers a served city in the airport's own country, then the biggest, never a blank label", () => {
    const mmx: OurAirport = { iata: "MMX", type: "large_airport", name: "Malmö", municipality: "Malmö", country: "SE", lat: 55.536, lng: 13.376 };
    const served = [
      { iata: "MMX", labels: { "zh-tw": "哥本哈根", en: "Copenhagen" }, lat: 55.676, lng: 12.568, country: "DK", population: 660000 },
      { iata: "MMX", labels: { "zh-tw": " ", en: "Malmö" }, lat: 55.605, lng: 13.0, country: "SE", population: 360000 },
    ];
    expect(buildAirportData([mmx], served, countries, {}).airports.MMX).toMatchObject({ city: "Malmö", cityEn: "Malmö", lat: 55.605 });

    const kefServed = [
      { iata: "KEF", labels: { "zh-tw": "凱夫拉維克", en: "Keflavík" }, lat: 64.0, lng: -22.55, country: "IS", population: 20000 },
      { iata: "KEF", labels: { "zh-tw": "雷克雅維克", en: "Reykjavík" }, lat: 64.1466, lng: -21.9426, country: "IS", population: 140000 },
    ];
    expect(buildAirportData([kef], kefServed, countries, {}).airports.KEF.city).toBe("雷克雅維克");

    // Wikidata puts Hong Kong (the city) in China: still taken when it's the only one.
    const hkg: OurAirport = { iata: "HKG", type: "large_airport", name: "Hong Kong Intl", municipality: "Hong Kong", country: "HK", lat: 22.31, lng: 113.91 };
    const hk = [{ iata: "HKG", labels: { "zh-tw": "香港", en: "Hong Kong" }, lat: 22.28, lng: 114.16, country: "CN" }];
    expect(buildAirportData([hkg], hk, countries, {}).airports.HKG.city).toBe("香港");

    const blank: OurAirport = { ...mmx, iata: "XXA", municipality: "" };
    expect(buildAirportData([blank], [{ iata: "XXA", labels: { en: " " }, lat: 55.6, lng: 13.0 }], countries, {}).airports.XXA.city).toBe("Malmö");
  });

  it("reports a Chinese city name shared by two countries", () => {
    const pdx: OurAirport = { iata: "PDX", type: "large_airport", name: "Portland Intl", municipality: "Portland", country: "US", lat: 45.59, lng: -122.6 };
    const pwm: OurAirport = { iata: "PWM", type: "medium_airport", name: "Portland Jetport", municipality: "Portland", country: "GB", lat: 43.6, lng: -70.3 };
    const { report } = buildAirportData([pdx, pwm], [], countries, {});
    expect(report.sharedNames).toEqual([{ city: "Portland", countries: ["GB", "US"] }]);
  });
});

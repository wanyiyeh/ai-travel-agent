/**
 * Turns the three open sources into the airport and country data files
 * (ADR-0011, scripts/build-airports.ts). Pure: the script downloads, this
 * parses and merges, so the rules can be tested without the network.
 */

import { haversineKm } from "@/lib/geo";

/** OurAirports sizes kept: travelers rarely fly straight into the rest. */
export const KEPT_AIRPORT_TYPES = ["large_airport", "medium_airport"];
/** A served city farther than this from its airport is likely the wrong one (KEF to Reykjavík is ~50 km). */
export const MAX_CITY_KM = 100;

export type GeneratedAirport = {
  /** Traditional Chinese city name, or the English one when Wikidata has none. */
  city: string;
  cityEn: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** The city's centre, where the day's searches anchor; the airport's own when unknown. */
  lat: number;
  lng: number;
  airportLat: number;
  airportLng: number;
};

export type GeneratedCountry = {
  /** Traditional Chinese name, or English when Wikidata has none. */
  name: string;
  /** ISO 4217, when the country has one. */
  currency?: string;
  /** World Bank price level ratio (PPP conversion factor / exchange rate), USA = 1. */
  priceLevel?: number;
  /** Units of `currency` per US dollar, the World Bank's yearly average. */
  perDollar?: number;
};

export type OurAirport = {
  iata: string;
  type: string;
  /** The airport's own name: the label of last resort. */
  name: string;
  municipality: string;
  country: string;
  lat: number;
  lng: number;
};

export type WikidataCity = {
  iata: string;
  /** Labels by language tag: zh-tw, zh-hant, zh-hk, en. */
  labels: Partial<Record<"zh-tw" | "zh-hant" | "zh-hk" | "en", string>>;
  lat?: number;
  lng?: number;
  /** ISO 3166-1 alpha-2 of the city's country, when Wikidata has it. */
  country?: string;
  population?: number;
};

export type WikidataCountry = {
  iso2: string;
  labels: Partial<Record<"zh-tw" | "zh-hant" | "zh-hk" | "en", string>>;
  currencies: string[];
};

/** RFC 4180: quoted fields may hold commas, quotes ("") and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The airports kept from OurAirports' airports.csv: a size we keep, scheduled flights, an IATA code. */
export function ourAirportsFrom(csv: string): OurAirport[] {
  const [header, ...rows] = parseCsv(csv);
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`OurAirports CSV has no "${name}" column`);
    return i;
  };
  const [type, scheduled, iata, municipality, country, lat, lng, name] = [
    "type",
    "scheduled_service",
    "iata_code",
    "municipality",
    "iso_country",
    "latitude_deg",
    "longitude_deg",
    "name",
  ].map(col);
  return rows
    .filter((r) => KEPT_AIRPORT_TYPES.includes(r[type]) && r[scheduled] === "yes" && /^[A-Z]{3}$/.test(r[iata] ?? ""))
    .map((r) => ({
      iata: r[iata],
      type: r[type],
      name: r[name],
      municipality: r[municipality],
      country: r[country],
      lat: Number(r[lat]),
      lng: Number(r[lng]),
    }));
}

// Traditional Chinese only: a plain "zh" label is often Simplified. Blank labels count as none.
const traditionalName = (labels: WikidataCity["labels"]) =>
  [labels["zh-tw"], labels["zh-hant"], labels["zh-hk"]].map((l) => l?.trim()).find(Boolean);
const englishName = (labels: WikidataCity["labels"]) => labels.en?.trim() || undefined;

const kmBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => haversineKm(a.lat, a.lng, b.lat, b.lng);

/**
 * Each country's price level against the US (US = 1): its PPP conversion
 * factor over its exchange rate, both in local currency per dollar. The World
 * Bank archived its ready-made ratio (PA.NUS.PPPC.RF), so it's derived here.
 */
export function priceLevelsFrom(pppPerDollar: Record<string, number>, ratePerDollar: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(pppPerDollar).flatMap(([iso2, ppp]) => {
      const rate = ratePerDollar[iso2];
      return rate > 0 && ppp > 0 ? [[iso2, Math.round((ppp / rate) * 1000) / 1000]] : [];
    })
  );
}

export type BuildReport = {
  airports: number;
  withChineseName: number;
  /** Served city dropped for being too far from its airport. */
  farCities: { iata: string; city: string; km: number }[];
  /** Kept airports Wikidata has no served city for. */
  noCity: string[];
  /** One Chinese city name in more than one country. */
  sharedNames: { city: string; countries: string[] }[];
  countriesWithoutCurrency: string[];
  countriesWithoutPriceLevel: string[];
  /** A country Wikidata gives more than one currency, and the one picked. */
  severalCurrencies: { country: string; currencies: string[]; picked: string }[];
};

export function buildAirportData(
  ourAirports: OurAirport[],
  cities: WikidataCity[],
  countries: WikidataCountry[],
  priceLevels: Record<string, number>,
  // A country with several currencies on Wikidata: the one travelers pay in.
  currencyOverrides: Record<string, string> = {},
  // The World Bank's local currency per US dollar.
  ratesPerDollar: Record<string, number> = {}
): { airports: Record<string, GeneratedAirport>; countries: Record<string, GeneratedCountry>; report: BuildReport } {
  const citiesByIata = new Map<string, WikidataCity[]>();
  for (const c of cities) citiesByIata.set(c.iata, [...(citiesByIata.get(c.iata) ?? []), c]);

  const airports: Record<string, GeneratedAirport> = {};
  const farCities: BuildReport["farCities"] = [];
  const noCity: string[] = [];
  for (const a of ourAirports) {
    if (airports[a.iata]) continue;
    const airport = { lat: a.lat, lng: a.lng };
    // Of the cities Wikidata says it serves, one close enough, Chinese name first.
    const candidates = (citiesByIata.get(a.iata) ?? []).filter((c) => c.lat !== undefined && c.lng !== undefined);
    // Of the served cities close enough, one in the airport's own country
    // first, then the biggest: where a traveler is headed. Malmö's airport
    // also serves København, across the border. Only a preference: Wikidata
    // puts Hong Kong's or Papeete's city in the parent country.
    const otherCountry = (c: WikidataCity) => (c.country && c.country !== a.country ? 1 : 0);
    const near = candidates
      .map((c) => ({ c, km: kmBetween(airport, { lat: c.lat!, lng: c.lng! }) }))
      .filter(({ km }) => km <= MAX_CITY_KM)
      .sort((x, y) => otherCountry(x.c) - otherCountry(y.c) || (y.c.population ?? 0) - (x.c.population ?? 0) || x.km - y.km)
      .map(({ c }) => c);
    const city = near[0];
    if (!city) {
      if (candidates.length > 0) {
        const c = candidates[0];
        farCities.push({ iata: a.iata, city: c.labels.en ?? traditionalName(c.labels) ?? "?", km: Math.round(kmBetween(airport, { lat: c.lat!, lng: c.lng! })) });
      } else noCity.push(a.iata);
    }
    const cityEn = (city && englishName(city.labels)) || a.municipality.trim() || a.name;
    airports[a.iata] = {
      city: (city && traditionalName(city.labels)) ?? cityEn,
      cityEn,
      country: a.country,
      lat: city?.lat ?? a.lat,
      lng: city?.lng ?? a.lng,
      airportLat: a.lat,
      airportLng: a.lng,
    };
  }

  const usedCountries = new Set(Object.values(airports).map((a) => a.country));
  const byIso = new Map(countries.map((c) => [c.iso2, c]));
  const outCountries: Record<string, GeneratedCountry> = {};
  const severalCurrencies: BuildReport["severalCurrencies"] = [];
  for (const iso2 of [...usedCountries].sort()) {
    const c = byIso.get(iso2);
    // Alphabetic codes only: Wikidata also lists numeric ones (Czechia's "203").
    const currencies = [...new Set(c?.currencies ?? [])].filter((code) => /^[A-Z]{3}$/.test(code)).sort();
    const currency = currencyOverrides[iso2] ?? currencies[0];
    if (currencies.length > 1) severalCurrencies.push({ country: iso2, currencies, picked: currency });
    outCountries[iso2] = {
      name: (c && traditionalName(c.labels)) ?? c?.labels.en ?? iso2,
      ...(currency ? { currency } : {}),
      ...(priceLevels[iso2] !== undefined ? { priceLevel: priceLevels[iso2] } : {}),
      // The World Bank's rate is in the local currency: a country set to pay
      // in dollars (Cambodia) has 1, not riel per dollar.
      ...(currency === "USD" ? { perDollar: 1 } : ratesPerDollar[iso2] !== undefined ? { perDollar: ratesPerDollar[iso2] } : {}),
    };
  }

  const countriesByName = new Map<string, Set<string>>();
  for (const a of Object.values(airports)) {
    countriesByName.set(a.city, (countriesByName.get(a.city) ?? new Set()).add(a.country));
  }

  return {
    airports,
    countries: outCountries,
    report: {
      airports: Object.keys(airports).length,
      withChineseName: Object.values(airports).filter((a) => a.city !== a.cityEn).length,
      farCities,
      noCity,
      sharedNames: [...countriesByName].filter(([, set]) => set.size > 1).map(([city, set]) => ({ city, countries: [...set].sort() })),
      countriesWithoutCurrency: Object.entries(outCountries).filter(([, c]) => !c.currency).map(([iso]) => iso),
      countriesWithoutPriceLevel: Object.entries(outCountries).filter(([, c]) => c.priceLevel === undefined).map(([iso]) => iso),
      severalCurrencies,
    },
  };
}

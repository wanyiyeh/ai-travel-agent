/**
 * Every airport a trip can fly to: the hand-kept AIRPORTS first, the data
 * built from open sources for the rest (ADR-0011, PLAN-003). Server code
 * looks airports up here; client code still imports the small AIRPORTS
 * directly, since the generated data is too big for the home page bundle.
 */

import { AIRPORTS } from "@/lib/airports";
import { IATA_COUNTRY_ZH } from "@/lib/iataCountry";
import type { GeneratedAirport, GeneratedCountry } from "@/lib/airportData/build";
import generatedAirports from "@/data/airports.generated.json";
import generatedCountries from "@/data/countries.generated.json";

const GENERATED = generatedAirports as Record<string, GeneratedAirport>;
const COUNTRIES = generatedCountries as Record<string, GeneratedCountry>;

// Hand-kept airports missing from the generated data: Cambodia's REP and
// PNH lost their scheduled flights to new airports (SAI, KTI) in 2023–25.
const CURATED_COUNTRY: Record<string, string> = { REP: "KH", PNH: "KH" };

export type AirportInfo = {
  iata: string;
  /** The name the app uses for the city: Chinese when known, else English. */
  cityZh: string;
  cityEn?: string;
  /** The city's centre (the hand-kept table's, when it has the airport). */
  lat: number;
  lng: number;
  /** The airport itself, when the generated data has it. */
  airport?: { lat: number; lng: number };
  /** ISO 3166-1 alpha-2; absent for a place in Taiwan (TW-xxx). */
  country?: string;
  countryZh?: string;
  currency?: string;
  /** World Bank price level against the US (US = 1). */
  priceLevel?: number;
  /** In the hand-kept AIRPORTS. */
  curated: boolean;
};

export function lookupAirport(iata: string): AirportInfo | undefined {
  const curated = AIRPORTS[iata];
  const generated = GENERATED[iata];
  if (!curated && !generated) return undefined;
  const country = curated?.domestic ? undefined : (generated?.country ?? CURATED_COUNTRY[iata]);
  const countryData = country ? COUNTRIES[country] : undefined;
  return {
    iata,
    cityZh: curated?.cityZh ?? generated!.city,
    ...(curated?.cityEn || generated ? { cityEn: curated?.cityEn ?? generated!.cityEn } : {}),
    lat: curated?.lat ?? generated!.lat,
    lng: curated?.lng ?? generated!.lng,
    ...(generated ? { airport: { lat: generated.airportLat, lng: generated.airportLng } } : {}),
    ...(country ? { country } : {}),
    ...(curated?.domestic ? {} : { countryZh: IATA_COUNTRY_ZH[iata] ?? countryData?.name }),
    ...(countryData?.currency ? { currency: countryData.currency } : {}),
    ...(countryData?.priceLevel !== undefined ? { priceLevel: countryData.priceLevel } : {}),
    curated: Boolean(curated),
  };
}

export function iataToCity(iata: string): string {
  return lookupAirport(iata)?.cityZh ?? iata;
}

export function getIataCoords(iata: string): { lat: number; lng: number } | null {
  const airport = lookupAirport(iata);
  return airport ? { lat: airport.lat, lng: airport.lng } : null;
}

// City name → airport code. Hand-kept names first, first code wins (NRT and
// HND are both 東京, same centre). A generated name shared by cities in
// different countries (伯明罕: UK and US) maps to nothing rather than a guess.
const CITY_TO_IATA = new Map<string, string>();
const AMBIGUOUS = new Set<string>();
for (const [code, airport] of Object.entries(AIRPORTS)) {
  if (!CITY_TO_IATA.has(airport.cityZh)) CITY_TO_IATA.set(airport.cityZh, code);
}
const curatedNames = new Set(CITY_TO_IATA.keys());
const generatedCountryOf = new Map<string, string>();
for (const [code, airport] of Object.entries(GENERATED)) {
  if (curatedNames.has(airport.city)) continue;
  const seen = generatedCountryOf.get(airport.city);
  if (seen === undefined) {
    generatedCountryOf.set(airport.city, airport.country);
    CITY_TO_IATA.set(airport.city, code);
  } else if (seen !== airport.country) AMBIGUOUS.add(airport.city);
}

export function cityToIata(cityName: string): string | undefined {
  return AMBIGUOUS.has(cityName) ? undefined : CITY_TO_IATA.get(cityName);
}

/** The country's Chinese name, for a code a trip can fly to. */
export function countryNameOf(iata: string): string | undefined {
  return lookupAirport(iata)?.countryZh;
}

export function currencyOf(iata: string): string | undefined {
  return lookupAirport(iata)?.currency;
}

import { cityToIata, lookupAirport } from "@/lib/airportIndex";

/**
 * Countries with no passenger trains a traveler could take for a day out
 * (ISO 3166-1 alpha-2). A day trip there goes by bus, not 「搭火車」: an
 * Iceland trip said 「從雷克雅維克搭火車約 1.5 小時到古佛斯」 (#310).
 */
export const NO_PASSENGER_RAIL = new Set([
  "BB", // Barbados
  "BN", // Brunei
  "BS", // Bahamas
  "BT", // Bhutan
  "CY", // Cyprus
  "FJ", // Fiji
  "GU", // Guam
  "IS", // Iceland
  "KW", // Kuwait
  "MT", // Malta
  "MV", // Maldives
  "NC", // New Caledonia
  "NP", // Nepal: one short line at the border
  "OM", // Oman
  "PF", // French Polynesia
  "PW", // Palau
]);

/** How a day trip out of a city goes: by car, or by whatever runs there. */
export type DayTripTravel = "drive" | "rail" | "bus";

/**
 * The way out of `cityName` for a traveler without a car: by bus in a country
 * without trains. A city with no airport of its own (a waypoint) goes by the
 * trip's airports — by bus only when none of them has trains.
 */
export function dayTripTravelFor(cityName: string, tripAirports: string[], selfDrive: boolean): DayTripTravel {
  if (selfDrive) return "drive";
  const code = cityToIata(cityName);
  const country = code ? lookupAirport(code)?.country : undefined;
  if (country) return NO_PASSENGER_RAIL.has(country) ? "bus" : "rail";
  const tripCountries = tripAirports.map((iata) => lookupAirport(iata)?.country);
  return tripCountries.length > 0 && tripCountries.every((c) => c && NO_PASSENGER_RAIL.has(c)) ? "bus" : "rail";
}

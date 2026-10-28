// Thin re-export kept for callers importing from this path. Server code
// gets the full lookup (src/lib/airportIndex.ts): the hand-kept airports
// plus the generated ones (ADR-0011).
import { AIRPORTS } from "@/lib/airports";
import { iataToCity, cityToIata } from "@/lib/airportIndex";

export const IATA_CITY_ZH: Record<string, string> = Object.fromEntries(
  Object.entries(AIRPORTS).map(([code, airport]) => [code, airport.cityZh]),
);

export { iataToCity, cityToIata };

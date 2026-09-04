// Thin re-export kept for callers importing from this path — the actual
// table now lives in src/lib/airports.ts (single source of truth for all
// IATA code -> city/coords data, see that file's header for why).
import { AIRPORTS, iataToCity, cityToIata } from "@/lib/airports";

export const IATA_CITY_ZH: Record<string, string> = Object.fromEntries(
  Object.entries(AIRPORTS).map(([code, airport]) => [code, airport.cityZh]),
);

export { iataToCity, cityToIata };

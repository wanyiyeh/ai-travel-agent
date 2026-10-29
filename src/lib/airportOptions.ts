/**
 * The airport picker's options on the client (PLAN-003): the hand-kept
 * AIRPORTS ship with the page; the generated ones are fetched from
 * /api/v1/airports the first time they're needed, once per page load.
 */

import { AIRPORTS } from "@/lib/airports";
import { IATA_COUNTRY_ZH } from "@/lib/iataCountry";

export type AirportOption = {
  code: string;
  /** Chinese city name, or English when there's none. */
  name: string;
  nameEn?: string;
  country: string;
};

export const CURATED_OPTIONS: AirportOption[] = Object.entries(AIRPORTS)
  .filter(([, airport]) => !airport.domestic)
  .map(([code, airport]) => ({
    code,
    name: airport.cityZh,
    ...(airport.cityEn ? { nameEn: airport.cityEn } : {}),
    country: IATA_COUNTRY_ZH[code] ?? "",
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));

let loading: Promise<AirportOption[]> | undefined;

/**
 * Every generated airport, hand-kept ones included (for their English
 * names); an empty list when the request fails, so the picker still works.
 */
export function loadMoreAirports(): Promise<AirportOption[]> {
  loading ??= fetch("/api/v1/airports")
    .then((res) => (res.ok ? (res.json() as Promise<AirportOption[]>) : []))
    .catch(() => {
      // Let a later open try again.
      loading = undefined;
      return [];
    });
  return loading;
}

/**
 * The hand-kept options, with English names from the full list, then every
 * other airport in it. The hand-kept names and countries win.
 */
export function mergeAirportOptions(curated: AirportOption[], full: AirportOption[]): AirportOption[] {
  const fullByCode = new Map(full.map((o) => [o.code, o]));
  const curatedCodes = new Set(curated.map((o) => o.code));
  return [
    ...curated.map((o) => ({ ...o, nameEn: o.nameEn ?? fullByCode.get(o.code)?.nameEn })),
    ...full.filter((o) => !curatedCodes.has(o.code)),
  ];
}

// "São Paulo" and "sao paulo" alike.
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Options matching what was typed, best first: the code, then a name that
 * starts with it, then one that has it anywhere; hand-kept airports before
 * generated ones within each.
 */
export function searchAirports(options: AirportOption[], query: string, limit: number): AirportOption[] {
  const q = fold(query.trim());
  if (!q) return options.slice(0, limit);
  const score = (o: AirportOption) => {
    const names = [o.name, o.nameEn ?? ""].map(fold);
    if (o.code.toLowerCase() === q) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    if (names.some((n) => n.includes(q)) || fold(o.country).includes(q)) return 2;
    return undefined;
  };
  return options
    .map((o, i) => ({ o, i, s: score(o) }))
    .filter((m): m is { o: AirportOption; i: number; s: number } => m.s !== undefined)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, limit)
    .map((m) => m.o);
}

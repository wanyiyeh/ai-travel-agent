/**
 * Builds the airport and country data files from three open sources
 * (ADR-0011, PLAN-003): OurAirports for the airport list, Wikidata for city
 * names, centres, countries and currencies, the World Bank for each
 * country's price level. Writes src/data/*.generated.json and prints a
 * report to check by hand. Re-run once a year (docs/runbook.md).
 *
 *   npm run build-airports
 *
 * Free: no Google or OpenAI calls. Stops without writing when a download
 * fails or the result looks wrong, so the committed files stay as they were.
 */

import { mkdirSync, writeFileSync } from "fs";
import {
  KEPT_AIRPORT_TYPES,
  buildAirportData,
  ourAirportsFrom,
  priceLevelsFrom,
  type WikidataCity,
  type WikidataCountry,
} from "@/lib/airportData/build";

const OURAIRPORTS_CSV = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
// PPP conversion factor and official exchange rate, both local currency per
// US$, latest year each; their ratio is the price level (priceLevelsFrom).
const worldBankIndicator = (id: string) =>
  `https://api.worldbank.org/v2/country/all/indicator/${id}?format=json&per_page=20000&mrnev=1`;
// Wikidata asks every client to say who it is.
const USER_AGENT = "ai-travel-agent/build-airports (https://github.com/wanyiyeh/ai-travel-agent)";
/** Fewer than this means a source changed shape, not that the world lost airports. */
const MIN_AIRPORTS = 1000;
const OUT_DIR = "src/data";

// The currency a traveler pays in, where Wikidata lists several (old ones
// included) or none. From the 2026-10 run's report.
const CURRENCY_OVERRIDES: Record<string, string> = {
  BA: "BAM", // not the old dinar (BAD)
  FO: "DKK", // Faroe Islands: none on Wikidata
  IM: "GBP", // Isle of Man: none on Wikidata
  MO: "MOP", // not HKD
  NL: "EUR", // not the Caribbean Netherlands' currencies
  PA: "USD", // the balboa is pegged to it and coins only
  ZW: "USD", // of the many listed, the one in use
};

const LANGS = ["zh-tw", "zh-hant", "zh-hk", "en"] as const;

/** Wikidata answers 429 when queried too fast; it says how long to wait. */
const MAX_TRIES = 3;
const DEFAULT_RETRY_SECONDS = 30;

async function get(url: string, accept: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: accept } });
    if (res.ok) return res.text();
    if (res.status !== 429 || attempt === MAX_TRIES) {
      throw new Error(`${url.slice(0, 120)} → ${res.status} ${res.statusText}`);
    }
    const wait = Number(res.headers.get("retry-after")) || DEFAULT_RETRY_SECONDS;
    console.log(`429 from ${new URL(url).hostname}, waiting ${wait}s (try ${attempt + 1}/${MAX_TRIES})`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

type SparqlRow = Record<string, { value: string; "xml:lang"?: string } | undefined>;

async function sparql(query: string): Promise<SparqlRow[]> {
  const body = await get(`${WIKIDATA_SPARQL}?query=${encodeURIComponent(query)}`, "application/sparql-results+json");
  return (JSON.parse(body) as { results: { bindings: SparqlRow[] } }).results.bindings;
}

const labelSelect = (subject: string) =>
  LANGS.map((lang) => `OPTIONAL { ${subject} rdfs:label ?${lang.replace("-", "_")} FILTER(LANG(?${lang.replace("-", "_")}) = "${lang}") }`).join("\n");
const labelsOf = (row: SparqlRow) =>
  Object.fromEntries(LANGS.flatMap((lang) => (row[lang.replace("-", "_")] ? [[lang, row[lang.replace("-", "_")]!.value]] : [])));

// "Point(-21.9426 64.1466)": longitude first.
function point(value: string | undefined): { lat: number; lng: number } | undefined {
  const m = value?.match(/^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/);
  return m ? { lng: Number(m[1]), lat: Number(m[2]) } : undefined;
}

async function wikidataCities(): Promise<WikidataCity[]> {
  const rows = await sparql(`
    SELECT ?iata ?city ?coord ?country (MAX(?pop) AS ?population) ${LANGS.map((l) => `(SAMPLE(?${l.replace("-", "_")}) AS ?${l.replace("-", "_")})`).join(" ")} WHERE {
      ?airport wdt:P238 ?iata .
      ?airport wdt:P931 ?city .
      OPTIONAL { ?city wdt:P625 ?coord }
      OPTIONAL { ?city wdt:P17 ?c . ?c wdt:P297 ?country }
      OPTIONAL { ?city wdt:P1082 ?pop }
      ${labelSelect("?city")}
    } GROUP BY ?iata ?city ?coord ?country`);
  return rows.map((row) => ({
    iata: row.iata!.value,
    labels: labelsOf(row),
    ...point(row.coord?.value),
    ...(row.country ? { country: row.country.value } : {}),
    ...(row.population ? { population: Number(row.population.value) } : {}),
  }));
}

async function wikidataCountries(): Promise<WikidataCountry[]> {
  const rows = await sparql(`
    SELECT ?iso2 ?code ${LANGS.map((l) => `?${l.replace("-", "_")}`).join(" ")} WHERE {
      ?country wdt:P297 ?iso2 .
      OPTIONAL { ?country wdt:P38 ?currency . ?currency wdt:P498 ?code }
      ${labelSelect("?country")}
    }`);
  const byIso = new Map<string, WikidataCountry>();
  for (const row of rows) {
    const iso2 = row.iso2!.value;
    const country: WikidataCountry = byIso.get(iso2) ?? { iso2, labels: labelsOf(row), currencies: [] };
    if (row.code) country.currencies.push(row.code.value);
    byIso.set(iso2, country);
  }
  return [...byIso.values()];
}

async function worldBankValues(indicator: string): Promise<Record<string, number>> {
  const body = JSON.parse(await get(worldBankIndicator(indicator), "application/json")) as [
    unknown,
    { country: { id: string }; value: number | null }[] | undefined,
  ];
  // An archived indicator answers with a message and no rows.
  if (!Array.isArray(body[1])) throw new Error(`World Bank indicator ${indicator}: ${JSON.stringify(body[0])}`);
  // Regions and income groups share the list; their ids aren't two letters.
  return Object.fromEntries(body[1].filter((r) => r.value !== null && /^[A-Z]{2}$/.test(r.country.id)).map((r) => [r.country.id, r.value!]));
}

async function worldBankPriceLevels(): Promise<Record<string, number>> {
  const [ppp, rate] = await Promise.all([worldBankValues("PA.NUS.PPP"), worldBankValues("PA.NUS.FCRF")]);
  return priceLevelsFrom(ppp, rate);
}

async function main() {
  const [csv, priceLevels] = await Promise.all([get(OURAIRPORTS_CSV, "text/csv"), worldBankPriceLevels()]);
  // One Wikidata query at a time: it limits concurrent queries per client.
  const cities = await wikidataCities();
  const countries = await wikidataCountries();
  const kept = ourAirportsFrom(csv);
  const { airports, countries: outCountries, report } = buildAirportData(
    kept,
    cities,
    countries,
    priceLevels,
    CURRENCY_OVERRIDES
  );
  if (report.airports < MIN_AIRPORTS) {
    throw new Error(`Only ${report.airports} airports (expected at least ${MIN_AIRPORTS}); not writing.`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const sorted = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(`${OUT_DIR}/airports.generated.json`, JSON.stringify(sorted(airports)) + "\n");
  writeFileSync(`${OUT_DIR}/countries.generated.json`, JSON.stringify(sorted(outCountries), null, 1) + "\n");

  const pct = (n: number) => `${Math.round((n / report.airports) * 100)}%`;
  const bySize = KEPT_AIRPORT_TYPES.map((t) => `${t} ${kept.filter((a) => a.type === t).length}`).join(", ");
  console.log(`Airports: ${report.airports} (${bySize}), Chinese city name: ${report.withChineseName} (${pct(report.withChineseName)})`);
  console.log(`No served city on Wikidata (airport's own place used): ${report.noCity.length}`);
  console.log(`Served city dropped, over the distance limit: ${report.farCities.length}`);
  for (const f of report.farCities.slice(0, 30)) console.log(`  ${f.iata} → ${f.city} (${f.km} km)`);
  console.log(`Chinese names shared by several countries: ${report.sharedNames.length}`);
  for (const s of report.sharedNames.slice(0, 30)) console.log(`  ${s.city}: ${s.countries.join(", ")}`);
  console.log(`Countries: ${Object.keys(outCountries).length}; without currency: ${report.countriesWithoutCurrency.join(", ") || "none"}`);
  console.log(`Without price level: ${report.countriesWithoutPriceLevel.join(", ") || "none"}`);
  console.log(`Several currencies (first picked unless overridden):`);
  for (const s of report.severalCurrencies) console.log(`  ${s.country}: ${s.currencies.join(", ")} → ${s.picked}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

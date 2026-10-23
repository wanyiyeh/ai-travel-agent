/**
 * Coordinates and types of stored places, looked up live: since #206 the
 * database keeps only place IDs and 30-day coordinates (ADR-0004,
 * ADR-0006), so scripts that used Place.types or stored coordinates ask
 * Google instead. Place Details Essentials, billed per place unless
 * MOCK_PLACES=1 (src/lib/googleFetch.ts).
 *
 * Without --yes on the command line it only prints how many places it would
 * look up and the estimated cost, and returns null (CLAUDE.md R1).
 */

import { fetchPlaceEssentials, type ResolvedPlace } from "@/lib/placesTextSearch";

// Place Details Essentials, first paid tier (docs/runbook.md, Google pricing page).
const ESSENTIALS_USD_PER_1000 = 5;
const CONCURRENCY = 5;

export async function loadPlaceEssentials(placeIds: Iterable<string>): Promise<Map<string, ResolvedPlace> | null> {
  const unique = [...new Set(placeIds)];
  const estimate = ((unique.length / 1000) * ESSENTIALS_USD_PER_1000).toFixed(2);
  if (!process.argv.includes("--yes")) {
    console.log(
      `Would look up ${unique.length} place(s) with Place Details Essentials (about US$${estimate}; free with MOCK_PLACES=1). ` +
        "Re-run with --yes to do it.",
    );
    return null;
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is not set");

  const places = new Map<string, ResolvedPlace>();
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < unique.length) {
      const id = unique[next++];
      try {
        const place = await fetchPlaceEssentials(id, apiKey);
        if (place) places.set(id, place);
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  console.log(`Looked up ${unique.length} place(s): ${places.size} found, ${failed} failed.`);
  return places;
}

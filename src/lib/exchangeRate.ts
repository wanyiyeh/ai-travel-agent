// open.er-api.com's free tier needs no API key and updates once a day —
// plenty for budget estimates (not a live spot rate). Not a Google service,
// so it doesn't go through googleFetch; it's free, so MOCK_PLACES leaves it
// alone. One request returns every currency against TWD.
const RATES_URL = "https://open.er-api.com/v6/latest/TWD";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cache: { fetchedAt: number; twdPerUnit: Record<string, number> } | null = null;

/**
 * NT$ per one unit of each currency (e.g. JPY -> ~0.21), with TWD itself
 * always 1. Never throws: an upstream failure returns just `{ TWD: 1 }`, so
 * callers fall back to whatever they do without a rate.
 */
export async function getTwdRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.twdPerUnit;

  try {
    const res = await fetch(RATES_URL, { next: { revalidate: CACHE_TTL_MS / 1000 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { result: string; rates?: Record<string, number> };
    if (data.result !== "success" || !data.rates) throw new Error("rates unavailable");

    // The API gives units-of-X per 1 TWD; invert to NT$ per 1 X.
    const twdPerUnit: Record<string, number> = { TWD: 1 };
    for (const [currency, perTwd] of Object.entries(data.rates)) {
      if (perTwd > 0) twdPerUnit[currency] = 1 / perTwd;
    }
    cache = { fetchedAt: Date.now(), twdPerUnit };
    return twdPerUnit;
  } catch (err) {
    console.warn("[exchangeRate] falling back to no conversion:", err);
    return { TWD: 1 };
  }
}

/** Test-only: forget the in-memory rates. */
export function resetTwdRatesCache(): void {
  cache = null;
}

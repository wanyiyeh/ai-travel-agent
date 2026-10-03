import { AsyncLocalStorage } from "node:async_hooks";

// Per-request tally of billable outbound calls, so we can see what one
// request (e.g. a trip generation) actually costs. googleFetch and the OpenAI
// client's fetch record into whatever tally is active; outside runMetered()
// nothing is recorded. Counts in MOCK_PLACES mode too, so `dev:mock` can
// measure call counts without paying Google.
// plan/access-control.md §3 (sizing the site-wide daily caps).

export interface UsageTally {
  // Keyed by endpoint + field mask: Places bills a request at the highest
  // tier of any field it asks for, so the mask decides the SKU.
  google: Record<string, number>;
  openai: { calls: number; promptTokens: number; completionTokens: number };
}

const storage = new AsyncLocalStorage<UsageTally>();

function newTally(): UsageTally {
  return { google: {}, openai: { calls: 0, promptTokens: 0, completionTokens: 0 } };
}

export async function runMetered<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const tally = newTally();
  return storage.run(tally, async () => {
    try {
      return await fn();
    } finally {
      console.info(`[usage] ${label} ${JSON.stringify(summarize(tally))}`);
    }
  });
}

export function currentTally(): UsageTally | undefined {
  return storage.getStore();
}

function googleEndpoint(url: string): string {
  if (url.includes("places:searchText")) return "textSearch";
  if (url.includes("places:searchNearby")) return "nearbySearch";
  if (url.includes("computeRouteMatrix")) return "routeMatrix";
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function fieldMask(init?: RequestInit): string {
  const headers = new Headers(init?.headers);
  return headers.get("X-Goog-FieldMask") ?? "";
}

export function recordGoogleCall(url: string, init?: RequestInit) {
  const tally = storage.getStore();
  if (!tally) return;
  const key = `${googleEndpoint(url)} [${fieldMask(init)}]`;
  tally.google[key] = (tally.google[key] ?? 0) + 1;
}

export function recordOpenAICall(usage?: { prompt_tokens?: number; completion_tokens?: number } | null) {
  const tally = storage.getStore();
  if (!tally) return;
  tally.openai.calls += 1;
  tally.openai.promptTokens += usage?.prompt_tokens ?? 0;
  tally.openai.completionTokens += usage?.completion_tokens ?? 0;
}

export function summarize(tally: UsageTally) {
  const googleTotal = Object.values(tally.google).reduce((a, b) => a + b, 0);
  return { googleTotal, google: tally.google, openai: tally.openai };
}

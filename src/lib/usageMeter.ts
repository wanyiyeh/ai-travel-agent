import { AsyncLocalStorage } from "node:async_hooks";
import { withRequestMemo } from "@/lib/requestMemo";

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

// A metered run is one request, so it's also where repeated lookups within
// the request are answered once (requestMemo.ts).
export async function runMetered<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const tally = newTally();
  return storage.run(tally, () => withRequestMemo(async () => {
    try {
      return await fn();
    } finally {
      const summary = summarize(tally);
      // A run that called nothing (a page view with every name still stored)
      // isn't worth a log line or a row.
      if (summary.googleTotal > 0 || summary.openai.calls > 0) {
        console.info(`[usage] ${label} ${JSON.stringify(summary)}`);
        await saveMeasurement(label, summary);
      }
    }
  }));
}

// Hosted logs don't last (Vercel Hobby keeps them briefly), so each tally is
// also kept as a UsageMeasurement row. Best-effort: a failed write never
// fails the request it measured.
async function saveMeasurement(label: string, summary: ReturnType<typeof summarize>): Promise<void> {
  try {
    // Imported here so code that only counts calls doesn't load Prisma.
    const { prisma } = await import("@/lib/db");
    await prisma.usageMeasurement.create({
      data: {
        label,
        google: JSON.stringify(summary.google),
        googleTotal: summary.googleTotal,
        openaiCalls: summary.openai.calls,
        promptTokens: summary.openai.promptTokens,
        completionTokens: summary.openai.completionTokens,
        mock: Boolean(process.env.MOCK_PLACES && process.env.MOCK_PLACES !== "0") || Boolean(process.env.MOCK_AI),
      },
    });
  } catch (err) {
    console.warn(`[usage] ${label}: couldn't save the measurement`, err);
  }
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

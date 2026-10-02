// Site-wide circuit breaker: a hard cap on billable outbound calls per UTC
// day, counted at the two choke points (googleFetch and the OpenAI client's
// fetch). Per-IP limits in rateLimit.ts can be dodged by spreading requests
// over many IPs; this can't. It's in-process, so it resets on restart — the
// GCP daily quotas and the OpenAI project spend limit are the outer caps.

export type BudgetedService = "google" | "openai";

// Well above a busy day of real use: one trip generation makes on the order
// of 50–100 Google calls and a dozen or so OpenAI calls.
export const DAILY_CALL_BUDGET: Record<BudgetedService, number> = {
  google: 3000,
  openai: 1000,
};

interface DayCount {
  day: string;
  count: number;
}

const globalForBudget = globalThis as unknown as { dailyCallCounts?: Map<BudgetedService, DayCount> };
const counts = (globalForBudget.dailyCallCounts ??= new Map());

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

// Counts one call and returns whether it's within today's budget. A refused
// call isn't counted, so the counter can't run away while blocked.
export function consumeDailyBudget(service: BudgetedService, now = Date.now()): boolean {
  const day = utcDay(now);
  let entry = counts.get(service);
  if (!entry || entry.day !== day) {
    entry = { day, count: 0 };
    counts.set(service, entry);
  }
  if (entry.count >= DAILY_CALL_BUDGET[service]) {
    console.warn(`[dailyBudget] ${service} daily call budget (${DAILY_CALL_BUDGET[service]}) exhausted; refusing call`);
    return false;
  }
  entry.count += 1;
  return true;
}

export function resetDailyBudgetForTests() {
  counts.clear();
}

// A synthetic 429 in place of the real call. Callers already treat a non-OK
// response as a transient failure (never cached), so nothing gets pinned.
// `x-should-retry: false` stops the OpenAI SDK from retrying it.
export function budgetExhaustedResponse(service: BudgetedService): Response {
  return new Response(JSON.stringify({ error: { message: `Daily ${service} call budget exhausted` } }), {
    status: 429,
    headers: { "Content-Type": "application/json", "x-should-retry": "false" },
  });
}

// Site-wide circuit breaker: a hard cap on billable outbound calls per UTC
// day, counted at the two choke points (googleFetch and the OpenAI client's
// fetch). Per-IP limits in rateLimit.ts can be dodged by spreading requests
// over many IPs; this can't. The count the app uses lives in Postgres
// (sharedStatePostgres.ts), so every server instance shares it (#209); the
// GCP daily quotas and the OpenAI project spend limit are the outer caps.

export type BudgetedService = "google" | "openai";

// Well above a busy day of real use: one trip generation makes on the order
// of 50–100 Google calls and a dozen or so OpenAI calls.
export const DAILY_CALL_BUDGET: Record<BudgetedService, number> = {
  google: 3000,
  openai: 1000,
};

export interface DailyBudgetStore {
  /**
   * Counts one call and returns whether it's within today's budget. A
   * refused call isn't counted, so the counter can't run away while blocked.
   */
  consume(service: BudgetedService, now?: number): Promise<boolean>;
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function warnBudgetExhausted(service: BudgetedService, limit: number): void {
  console.warn(`[dailyBudget] ${service} daily call budget (${limit}) exhausted; refusing call`);
}

/** In-process counts, for the unit tests (sharedState.ts). */
export function createMemoryDailyBudget(limits: Record<BudgetedService, number> = DAILY_CALL_BUDGET): DailyBudgetStore {
  const counts = new Map<BudgetedService, { day: string; count: number }>();
  return {
    async consume(service, now = Date.now()) {
      const day = utcDay(now);
      let entry = counts.get(service);
      if (!entry || entry.day !== day) {
        entry = { day, count: 0 };
        counts.set(service, entry);
      }
      if (entry.count >= limits[service]) {
        warnBudgetExhausted(service, limits[service]);
        return false;
      }
      entry.count += 1;
      return true;
    },
  };
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

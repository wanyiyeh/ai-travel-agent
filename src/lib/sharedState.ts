import { createMemoryDailyBudget, type BudgetedService, type DailyBudgetStore } from "@/lib/dailyBudget";
import { createMemoryGate, createMemoryStore, type ConcurrencyGate, type RateLimitStore } from "@/lib/rateLimit";
import { createPostgresDailyBudget, createPostgresGate, createPostgresRateLimitStore } from "@/lib/sharedStatePostgres";

/**
 * The stores the app uses for state every server instance must share: the
 * per-client rate limit (src/proxy.ts), the generation lock
 * (generate-stream) and the site-wide daily call budget (googleFetch,
 * openai). Postgres by default (#209); SHARED_STATE=memory gives in-process
 * ones, for the unit tests, which never touch a database (vitest.config.mts).
 */

const useMemory = process.env.SHARED_STATE === "memory";

// Survive Next dev's module reloads, so the memory stores keep their counts.
const globalForSharedState = globalThis as unknown as {
  apiRateLimitStore?: RateLimitStore;
  generateStreamGate?: ConcurrencyGate;
  dailyBudgetStore?: DailyBudgetStore;
};

export const apiRateLimitStore = (globalForSharedState.apiRateLimitStore ??= useMemory
  ? createMemoryStore()
  : createPostgresRateLimitStore());

export const generateStreamGate = (globalForSharedState.generateStreamGate ??= useMemory
  ? createMemoryGate()
  : createPostgresGate());

let dailyBudgetStore = (globalForSharedState.dailyBudgetStore ??= useMemory
  ? createMemoryDailyBudget()
  : createPostgresDailyBudget());

export function consumeDailyBudget(service: BudgetedService): Promise<boolean> {
  return dailyBudgetStore.consume(service);
}

/** Unit tests: a fresh in-memory budget. */
export function resetDailyBudgetForTests(): void {
  dailyBudgetStore = globalForSharedState.dailyBudgetStore = createMemoryDailyBudget();
}

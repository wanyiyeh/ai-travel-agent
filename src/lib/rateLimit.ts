// Per-client request limits for /api/*, enforced in src/proxy.ts before any
// route runs. The point is cost: one scripted client looping on a route that
// calls OpenAI or Google would otherwise bill without limit.
//
// The store is in-process memory, which is right for a single server (or
// `next dev`). On a multi-instance / serverless deploy each instance would
// count separately — swap createMemoryStore() for a shared store (e.g.
// Redis) behind the same RateLimitStore interface. See
// plan/security-hardening.md Phase 1b.

export type RateLimitTier = "generate" | "ai" | "google" | "photo" | "default";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Sized for one real person using the app, with headroom: opening an
// itinerary page fires one enrich request per stop/day at once (dozens), and
// each picker renders a column of photo thumbnails.
export const RATE_LIMITS: Record<RateLimitTier, RateLimitRule> = {
  // A full trip generation: the most expensive single request in the app.
  generate: { limit: 30, windowMs: DAY_MS },
  // User-triggered OpenAI calls (regenerate, suggestions, restructure, ...).
  ai: { limit: 60, windowMs: HOUR_MS },
  // Google Places/Routes lookups, including the page-open auto-enrich burst.
  google: { limit: 120, windowMs: MINUTE_MS },
  photo: { limit: 300, windowMs: MINUTE_MS },
  // DB-only routes.
  default: { limit: 300, windowMs: MINUTE_MS },
};

// Matched against the path after /api/v1/. Order matters: first match wins.
const TIER_PATTERNS: [RateLimitTier, RegExp][] = [
  ["generate", /^generate-stream$/],
  ["photo", /^places\/[^/]+\/photo$/],
  [
    "ai",
    /^(days\/[^/]+\/(accommodation\/regenerate|meals\/[^/]+\/regenerate|stop-suggestions|stops)|itinerary\/[^/]+\/(restructure|transit-recommendations))$/,
  ],
  [
    "google",
    /^(days\/[^/]+\/(accommodation\/enrich|recalculate-transport)|itinerary\/[^/]+\/enrich-all-stops|places\/(search|city-centers)|stops\/[^/]+\/enrich)$/,
  ],
];

export function classifyApiPath(pathname: string, method: string): RateLimitTier {
  const match = /^\/api\/v1\/(.+?)\/?$/.exec(pathname);
  if (!match) return "default";
  // Every OpenAI/Google route is a POST except the photo proxy (GET); reads
  // like GET /days/x/stops/.../candidates-history stay in the cheap tier.
  if (method !== "POST" && method !== "GET") return "default";
  for (const [tier, pattern] of TIER_PATTERNS) {
    if (pattern.test(match[1])) {
      if (tier !== "photo" && method !== "POST") return "default";
      return tier;
    }
  }
  return "default";
}

// x-forwarded-for is set by the hosting platform's proxy (Vercel, a reverse
// proxy in front of `next start`, and `next dev` itself). Without a trusted
// proxy in front, a client can forge it to dodge per-IP limits — the global
// daily budget in dailyBudget.ts is the backstop for that.
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  hit(key: string, rule: RateLimitRule, now?: number): RateLimitResult;
}

interface WindowEntry {
  windowStart: number;
  count: number;
  prevCount: number;
}

// Sliding-window counter: estimates the rolling-window count from the current
// fixed window plus the previous one, weighted by how much of it still
// overlaps. O(1) memory per key, without the 2x burst a plain fixed window
// allows at a window boundary. Blocked requests don't count against the limit.
export function createMemoryStore(maxKeys = 10_000): RateLimitStore {
  const entries = new Map<string, WindowEntry>();

  return {
    hit(key, { limit, windowMs }, now = Date.now()) {
      const windowStart = Math.floor(now / windowMs) * windowMs;
      let entry = entries.get(key);
      if (!entry || entry.windowStart < windowStart - windowMs) {
        entry = { windowStart, count: 0, prevCount: 0 };
      } else if (entry.windowStart < windowStart) {
        entry = { windowStart, count: 0, prevCount: entry.count };
      }

      const elapsed = now - windowStart;
      const prevWeight = 1 - elapsed / windowMs;
      const estimated = entry.prevCount * prevWeight + entry.count;

      // Re-insert so Map order tracks recency; evict the stalest key when full.
      entries.delete(key);
      if (entries.size >= maxKeys) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, entry);

      if (estimated + 1 > limit) {
        return { allowed: false, remaining: 0, retryAfterSeconds: retryAfter(entry, limit, windowMs, elapsed) };
      }
      entry.count += 1;
      return { allowed: true, remaining: Math.max(0, Math.floor(limit - estimated - 1)), retryAfterSeconds: 0 };
    },
  };
}

// Seconds until the estimate drops enough to admit one more request.
function retryAfter(entry: WindowEntry, limit: number, windowMs: number, elapsed: number): number {
  const untilWindowEnd = windowMs - elapsed;
  let waitMs: number;
  if (entry.count + 1 > limit || entry.prevCount === 0) {
    // Even with the previous window fully decayed, this window alone is full.
    waitMs = untilWindowEnd;
  } else {
    // Need prevCount * (1 - t/windowMs) + count + 1 <= limit.
    const decayedAt = windowMs * (1 - (limit - entry.count - 1) / entry.prevCount);
    waitMs = Math.max(0, decayedAt - elapsed);
  }
  return Math.max(1, Math.ceil(waitMs / 1000));
}

// Survives Next dev's module reloads, like the other in-process caches here.
const globalForRateLimit = globalThis as unknown as { apiRateLimitStore?: RateLimitStore };
export const apiRateLimitStore = (globalForRateLimit.apiRateLimitStore ??= createMemoryStore());

// Caps how many long-running requests one client can have open at once — a
// trip generation streams for tens of seconds and fans out into many
// OpenAI/Google calls, so parallel ones multiply cost faster than the
// per-day count alone would catch.
export interface ConcurrencyGate {
  tryAcquire(key: string): boolean;
  release(key: string): void;
}

export function createConcurrencyGate(maxPerKey: number): ConcurrencyGate {
  const active = new Map<string, number>();
  return {
    tryAcquire(key) {
      const current = active.get(key) ?? 0;
      if (current >= maxPerKey) return false;
      active.set(key, current + 1);
      return true;
    },
    release(key) {
      const current = active.get(key) ?? 0;
      if (current <= 1) active.delete(key);
      else active.set(key, current - 1);
    },
  };
}

const globalForGate = globalThis as unknown as { generateStreamGate?: ConcurrencyGate };
export const generateStreamGate = (globalForGate.generateStreamGate ??= createConcurrencyGate(1));

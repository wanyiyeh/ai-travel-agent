// Per-client request limits for /api/*, enforced in src/proxy.ts before any
// route runs. The point is cost: one scripted client looping on a route that
// calls OpenAI or Google would otherwise bill without limit.
//
// Serverless instances don't share memory, so the stores the app uses live
// in Postgres (sharedStatePostgres.ts, picked in sharedState.ts, #209); the
// in-memory ones here serve the unit tests.

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
  hit(key: string, rule: RateLimitRule, now?: number): Promise<RateLimitResult>;
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
// Shared by both stores: given this window's and the previous window's
// counts, whether one more request fits.
export function decideWindow(count: number, prevCount: number, { limit, windowMs }: RateLimitRule, now: number): RateLimitResult {
  const elapsed = now - Math.floor(now / windowMs) * windowMs;
  const estimated = prevCount * (1 - elapsed / windowMs) + count;
  if (estimated + 1 > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: retryAfter({ windowStart: 0, count, prevCount }, limit, windowMs, elapsed) };
  }
  return { allowed: true, remaining: Math.max(0, Math.floor(limit - estimated - 1)), retryAfterSeconds: 0 };
}

export function createMemoryStore(maxKeys = 10_000): RateLimitStore {
  const entries = new Map<string, WindowEntry>();

  return {
    async hit(key, rule, now = Date.now()) {
      const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
      let entry = entries.get(key);
      if (!entry || entry.windowStart < windowStart - rule.windowMs) {
        entry = { windowStart, count: 0, prevCount: 0 };
      } else if (entry.windowStart < windowStart) {
        entry = { windowStart, count: 0, prevCount: entry.count };
      }

      // Re-insert so Map order tracks recency; evict the stalest key when full.
      entries.delete(key);
      if (entries.size >= maxKeys) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, entry);

      const result = decideWindow(entry.count, entry.prevCount, rule, now);
      if (result.allowed) entry.count += 1;
      return result;
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

// One long-running request per client at a time — a trip generation streams
// for tens of seconds and fans out into many OpenAI/Google calls, so
// parallel ones multiply cost faster than the per-day count alone would
// catch. A lease expires after GENERATION_LEASE_MS even if never released
// (an instance that crashed mid-generation), and releasing needs the lease,
// so a late release can't free the next request's lock.
export const GENERATION_LEASE_MS = 10 * 60 * 1000;

export interface ConcurrencyGate {
  /** A lease to hand back to release(), or null when the key is busy. */
  tryAcquire(key: string, now?: number): Promise<string | null>;
  release(key: string, lease: string): Promise<void>;
}

export function createMemoryGate(leaseMs = GENERATION_LEASE_MS): ConcurrencyGate {
  const held = new Map<string, { lease: string; expiresAt: number }>();
  return {
    async tryAcquire(key, now = Date.now()) {
      const current = held.get(key);
      if (current && current.expiresAt > now) return null;
      const lease = crypto.randomUUID();
      held.set(key, { lease, expiresAt: now + leaseMs });
      return lease;
    },
    async release(key, lease) {
      if (held.get(key)?.lease === lease) held.delete(key);
    },
  };
}

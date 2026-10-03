import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

// The route must never get as far as OpenAI in these tests.
const createCompletion = vi.fn();
vi.mock("@/lib/openai", () => ({ openai: { chat: { completions: { create: createCompletion } } } }));

const { POST } = await import("@/app/api/v1/generate-stream/route");

// Story: a script posts straight to the generate API without passing the
// Turnstile check. It must be refused before a guest is created, before any
// usage is recorded, and before any paid call. plan/access-control.md §3.

const body = {
  flightInfo: { departureCity: "TPE", arrivalCity: "ICN", returnDepartureCity: "ICN", departureDate: "2026-11-10", returnDate: "2026-11-13" },
};
const post = (extra: Record<string, unknown> = {}) =>
  POST(new Request("http://test/api", {
    method: "POST",
    headers: { "x-forwarded-for": "198.51.100.77" },
    body: JSON.stringify({ ...body, ...extra }),
  }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("generate-stream refuses requests that fail the bot check", () => {
  it.each([
    ["no token", {}, { success: true }],
    ["a token Cloudflare rejects", { turnstileToken: "forged" }, { success: false, "error-codes": ["invalid-input-response"] }],
  ])("%s → 403, nothing created or billed", async (_label, extra, siteverify) => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(siteverify))));
    const guestsBefore = await prisma.user.count({ where: { isGuest: true } });
    const usageBefore = await prisma.usageEvent.count();

    const res = await post(extra);

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("captcha_failed");
    expect(await prisma.user.count({ where: { isGuest: true } })).toBe(guestsBefore);
    expect(await prisma.usageEvent.count()).toBe(usageBefore);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("releases the one-at-a-time lock, so the next request isn't told one is in progress", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }))));
    expect((await post()).status).toBe(403);
    expect((await post()).status).toBe(403); // not 429
  });
});

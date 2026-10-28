import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

// The route must never get as far as OpenAI in these tests.
const createCompletion = vi.fn();
vi.mock("@/lib/openai", () => ({ openai: { chat: { completions: { create: createCompletion } } } }));

const { POST } = await import("@/app/api/v1/generate-stream/route");

// Story (PLAN-003): the picker now offers every scheduled large and medium
// airport. A code no airport has is refused before anything is created or
// billed; one beyond the hand-kept list gets past the airport check.

const post = (flightInfo: Record<string, string>) =>
  POST(
    new Request("http://test/api", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.78" },
      body: JSON.stringify({ flightInfo: { departureDate: "2026-11-10", returnDate: "2026-11-13", ...flightInfo } }),
    })
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("generate-stream and airport codes", () => {
  it("refuses a code no airport has, before creating or billing anything", async () => {
    const guestsBefore = await prisma.user.count({ where: { isGuest: true } });
    const usageBefore = await prisma.usageEvent.count();

    const res = await post({ departureCity: "TPE", arrivalCity: "ZZQ", returnDepartureCity: "ZZQ" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("ZZQ");
    expect(await prisma.user.count({ where: { isGuest: true } })).toBe(guestsBefore);
    expect(await prisma.usageEvent.count()).toBe(usageBefore);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it("lets an airport beyond the hand-kept list through to the next check", async () => {
    // Stop at the bot check that follows, so nothing is generated.
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }))));

    const res = await post({ departureCity: "TPE", arrivalCity: "LIM", returnDepartureCity: "LIM" });

    expect(res.status).toBe(403);
    expect(createCompletion).not.toHaveBeenCalled();
  });
});

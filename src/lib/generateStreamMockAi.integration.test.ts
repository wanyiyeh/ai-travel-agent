import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { calcDays } from "@/lib/itineraryGen";
import { mockGoogleResponse } from "@/lib/mockPlaces";

const { POST } = await import("@/app/api/v1/generate-stream/route");

// Story: a developer checks a change to the generation pipeline without
// paying for it. MOCK_AI (set for the whole integration suite) answers every
// model call from mockAi.ts, and Google is faked the way MOCK_PLACES fakes it
// — so a full trip comes back through the rule-engine path, saved like any
// other, with no request ever reaching OpenAI.

type StreamEvent = { type: string; [key: string]: unknown };

async function readEvents(res: Response): Promise<StreamEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as StreamEvent);
}

// By host, not substring: a URL can mention a domain anywhere in its path.
const isHost = (url: string, domain: string) => {
  const host = new URL(url).hostname;
  return host === domain || host.endsWith(`.${domain}`);
};

function fakeNetwork() {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      if (isHost(url, "googleapis.com")) return mockGoogleResponse(url, init);
      // Weather and exchange rates are free; an empty answer is enough here.
      return new Response("{}", { status: 404 });
    }),
  );
  return urls;
}

function generate(flightInfo: Record<string, string>, ip: string) {
  return POST(
    new Request("http://test/api", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: JSON.stringify({ flightInfo }),
    }),
  );
}

// test.db outlives a run, and each generation counts against the guest
// quota, so start from no usage or a rerun is refused with a 429.
beforeEach(async () => {
  await prisma.usageEvent.deleteMany({});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("generate-stream with MOCK_AI and faked Google", () => {
  it("builds and saves a whole trip through the rule-engine path, never calling OpenAI", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", ""); // bot check off; it has its own tests
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "integration-fake-key");
    const urls = fakeNetwork();

    const startedAt = new Date();
    const flightInfo = { departureCity: "TPE", arrivalCity: "NRT", returnDepartureCity: "NRT", departureDate: "2026-11-10", returnDate: "2026-11-13" };
    const res = await generate(flightInfo, "198.51.100.120");
    expect(res.status).toBe(200);
    const events = await readEvents(res);

    // A "complete" can only come from the rule-engine path here: the old
    // full-LLM fallback is refused by openai.ts under MOCK_AI.
    expect(events.map((e) => e.type)).toContain("plan");
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    const complete = events.find((e) => e.type === "complete") as { data: { days: unknown[] }; id: string } | undefined;
    expect(complete).toBeDefined();
    expect(complete!.data.days).toHaveLength(calcDays(flightInfo.departureDate, flightInfo.returnDate));

    const saved = await prisma.itinerary.findUnique({ where: { id: complete!.id } });
    expect(saved).not.toBeNull();

    expect(urls.filter((u) => isHost(u, "openai.com"))).toEqual([]);

    // The run's call counts outlive the log (usageMeter.ts), marked as mock.
    const measurement = await prisma.usageMeasurement.findFirst({
      where: { label: "generate-stream", createdAt: { gte: startedAt } },
    });
    expect(measurement).toMatchObject({ mock: true, openaiCalls: 0 });
  });

  it("with MOCK_AI=error the fallback is refused too, so the traveler gets an error and nothing is billed", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "integration-fake-key");
    vi.stubEnv("MOCK_AI", "error");
    const urls = fakeNetwork();

    const res = await generate(
      { departureCity: "TPE", arrivalCity: "KIX", returnDepartureCity: "KIX", departureDate: "2026-11-10", returnDate: "2026-11-12" },
      "198.51.100.121",
    );
    const events = await readEvents(res);

    expect(events.find((e) => e.type === "complete")).toBeUndefined();
    expect(events.map((e) => e.type)).toContain("error");
    expect(urls.filter((u) => isHost(u, "openai.com"))).toEqual([]);
  });
});

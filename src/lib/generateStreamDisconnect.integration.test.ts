import { afterEach, describe, expect, it, vi } from "vitest";

// The old full-LLM flow's completion call — must not run in this story.
const createCompletion = vi.fn();
vi.mock("@/lib/openai", () => ({ openai: { chat: { completions: { create: createCompletion } } } }));

// The rule-engine path, held open until the test has disconnected, then it
// reports progress (which used to throw on the closed stream) and gives up.
let releaseRuleEngine!: () => void;
const ruleEngineHeld = new Promise<void>((resolve) => {
  releaseRuleEngine = resolve;
});
let ruleEngineDone!: () => void;
const ruleEngineFinished = new Promise<void>((resolve) => {
  ruleEngineDone = resolve;
});
vi.mock("@/lib/assembleItineraryDays", () => ({
  assembleItineraryDays: async (...args: unknown[]) => {
    const onProgress = args[4] as (event: unknown) => void;
    onProgress({ type: "plan", title: "t", currency: "JPY", cities: [] });
    await ruleEngineHeld;
    onProgress({ type: "day", day: { day: 1, stops: [] } });
    ruleEngineDone();
    return null;
  },
}));

const { POST } = await import("@/app/api/v1/generate-stream/route");

// Story: the traveler closes the tab while the itinerary is being generated.
// Writing to the closed stream used to throw, which the route mistook for a
// rule-engine failure — it then paid for the whole old-flow fallback that
// nobody would ever see.
describe("generate-stream when the browser disconnects mid-generation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stops quietly instead of paying for the old-flow fallback", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", ""); // bot check off; it has its own tests
    const res = await POST(
      new Request("http://test/api", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.91" },
        body: JSON.stringify({
          flightInfo: {
            departureCity: "TPE",
            arrivalCity: "NRT",
            returnDepartureCity: "NRT",
            departureDate: "2026-11-10",
            returnDate: "2026-11-13",
          },
        }),
      })
    );
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('"type":"plan"');

    await reader.cancel(); // the tab closes
    releaseRuleEngine();
    await ruleEngineFinished;
    // let the route's code after the rule-engine call run
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(createCompletion).not.toHaveBeenCalled();
  });
});

import OpenAI from "openai";
import { budgetExhaustedResponse, consumeDailyBudget } from "@/lib/dailyBudget";
import { getMockMode } from "@/lib/mockAi";
import { currentTally, recordOpenAICall } from "@/lib/usageMeter";

// MOCK_AI never reaches OpenAI (see the fetch below), so it needs no key.
if (!process.env.OPENAI_API_KEY && !getMockMode()) {
  throw new Error("Missing OPENAI_API_KEY environment variable");
}

// A 400 with x-should-retry: false fails the request at once; the SDK would
// retry a 5xx.
function mockAiBlockedResponse(): Response {
  return new Response(
    JSON.stringify({ error: { message: "MOCK_AI is set: a real OpenAI call was blocked (mock it in mockAi.ts)" } }),
    { status: 400, headers: { "Content-Type": "application/json", "x-should-retry": "false" } },
  );
}

// Every OpenAI request in the app goes through this one client, so its fetch
// is the choke point for the site-wide daily call budget and usage metering.
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "mock-ai-no-key",
  fetch: async (url, init) => {
    // MOCK_AI: anything that got past mockCompletion() or a route's own
    // fixture is refused here rather than billed — e.g. the old full-LLM
    // fallback in generate-stream, which then reports its usual error.
    if (getMockMode()) return mockAiBlockedResponse();
    if (!consumeDailyBudget("openai")) return budgetExhaustedResponse("openai");
    const res = await fetch(url, init);
    if (currentTally()) {
      // Token counts come back in the JSON body; a streamed response doesn't
      // carry them by default, so it's counted as a call with 0 tokens.
      const isStream = typeof init?.body === "string" && init.body.includes('"stream":true');
      const usage = !isStream && res.ok ? await res.clone().json().then((b) => b?.usage, () => null) : null;
      recordOpenAICall(usage);
    }
    return res;
  },
});

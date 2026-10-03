import OpenAI from "openai";
import { budgetExhaustedResponse, consumeDailyBudget } from "@/lib/dailyBudget";
import { currentTally, recordOpenAICall } from "@/lib/usageMeter";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY environment variable");
}

// Every OpenAI request in the app goes through this one client, so its fetch
// is the choke point for the site-wide daily call budget and usage metering.
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  fetch: async (url, init) => {
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

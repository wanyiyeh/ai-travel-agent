import OpenAI from "openai";
import { budgetExhaustedResponse, consumeDailyBudget } from "@/lib/dailyBudget";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY environment variable");
}

// Every OpenAI request in the app goes through this one client, so its fetch
// is the choke point for the site-wide daily call budget.
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  fetch: (url, init) => {
    if (!consumeDailyBudget("openai")) return Promise.resolve(budgetExhaustedResponse("openai"));
    return fetch(url, init);
  },
});

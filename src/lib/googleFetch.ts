import { isMockPlaces, mockGoogleResponse } from "@/lib/mockPlaces";
import { budgetExhaustedResponse, consumeDailyBudget } from "@/lib/dailyBudget";
import { recordGoogleCall } from "@/lib/usageMeter";

// Every billable Google Places / Routes HTTP call goes through here, so
// MOCK_PLACES can swap in fake responses at one choke point (see
// lib/mockPlaces.ts), and the site-wide daily call budget (lib/dailyBudget.ts)
// is enforced in one place. Add any new Google API call site here too, or it
// will silently keep billing in mock mode and bypass the budget.
export function googleFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isMockPlaces()) {
    // Still recorded, so dev:mock measures the calls a real run would make.
    recordGoogleCall(url, init);
    return Promise.resolve(mockGoogleResponse(url, init));
  }
  // A call refused by the budget never leaves the server, so it isn't recorded.
  if (!consumeDailyBudget("google")) return Promise.resolve(budgetExhaustedResponse("google"));
  recordGoogleCall(url, init);
  return fetch(url, init);
}

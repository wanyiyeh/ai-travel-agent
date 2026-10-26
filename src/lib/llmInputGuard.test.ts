import { beforeEach, describe, expect, it, vi } from "vitest";
import { capturedMessages, expectNoGoogleContent, googleName } from "@tests/contracts/googleContent";
import type { RestaurantHint } from "@/lib/fetchCityRestaurants";

// ADR-0008 guard: every OpenAI call fed by Google places must leave the
// places' Google content out of the prompt. Call sites that still send it
// are marked it.fails until their PLAN-002 sub-issue fixes them; switch
// each back to it() then (vitest reports an it.fails that starts passing).
// Stop copy (skeletonCopy.ts, #265), the trip-wide missing copy (#266) and
// place name translation (#268) no longer call OpenAI.

const createMock = vi.fn();
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
}));

const { suggestFallbackText } = await import("@/lib/stopSuggestionFallback");
const { buildAttractionHintsPrompt, buildRestaurantHintsPrompt } = await import("@/lib/fetchCityRestaurants");

const hint = (label: string, lat: number): RestaurantHint => ({
  name: googleName(label),
  rating: 4.5,
  lat,
  lng: 139.79,
  types: ["tourist_attraction"],
});

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue({ choices: [{ message: { content: "{}" } }] });
});

describe("LLM input carries no Google Maps content (ADR-0008)", () => {
  it("the marker check catches a Google name", () => {
    expect(() => expectNoGoogleContent([{ role: "user", content: googleName("淺草寺") }])).toThrow();
    expect(() => expectNoGoogleContent([{ role: "user", content: "東京，上午，停留約 60 分鐘" }])).not.toThrow();
  });

  // #267: the day's names (Google's) only filter the model's suggestions.
  it("stop picker's text fallback", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ candidates: [
        { name: googleName("淺草寺"), description: "d", duration_minutes: 60 },
        { name: "上野公園", description: "d", duration_minutes: 90 },
      ] }) } }],
    });
    const suggestions = await suggestFallbackText("test-model", "東京 5 天", "東京 文化巡禮", [googleName("淺草寺")]);
    expectNoGoogleContent(...capturedMessages(createMock));
    expect(suggestions.map((c) => c.name)).toEqual(["上野公園"]);
  });

  // #269: the old full-LLM fallback's prompt is built from these.
  it.fails("old fallback: attraction hints", () => {
    expectNoGoogleContent(buildAttractionHintsPrompt([{ cityNameZh: "東京", attractions: [hint("淺草寺", 35.71)] }]));
  });

  it.fails("old fallback: restaurant hints", () => {
    expectNoGoogleContent(
      buildRestaurantHintsPrompt([
        { cityNameZh: "東京", iataCode: "HND", breakfastPlaces: [hint("Bills", 35.67)], mainMealPlaces: [hint("一蘭", 35.69)], snackPlaces: [] },
      ]),
    );
  });
});

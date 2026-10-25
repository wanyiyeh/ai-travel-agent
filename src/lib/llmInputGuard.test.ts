import { beforeEach, describe, expect, it, vi } from "vitest";
import { capturedMessages, expectNoGoogleContent, googleName } from "@tests/contracts/googleContent";
import type { RestaurantHint } from "@/lib/fetchCityRestaurants";

// ADR-0008 guard: every OpenAI call fed by Google places must leave the
// places' Google content out of the prompt. Call sites that still send it
// are marked it.fails until their PLAN-002 sub-issue fixes them; switch
// each back to it() then (vitest reports an it.fails that starts passing).
// The rule-engine day's stop copy (skeletonCopy.ts) no longer calls OpenAI (#265).

const createMock = vi.fn();
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
}));

const { fillMissingCopy } = await import("@/lib/missingCopy");
const { translatePlaceNames } = await import("@/lib/translatePlaceNames");
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

  // #266
  it.fails("missing copy for places the program put in", async () => {
    const days = [
      {
        waypointCity: "東京",
        stops: [{ name: googleName("鶴岡八幡宮"), placeId: "p1", copyPending: true }],
        meals: { snack: { name: googleName("Bear Pond Espresso"), placeId: "m1" } },
      },
    ];
    await fillMissingCopy(days, "test-model");
    expect(createMock).toHaveBeenCalled();
    expectNoGoogleContent(...capturedMessages(createMock));
  });

  // #268: the function goes away; its input is Google names by definition.
  it.fails("place name translation", async () => {
    await translatePlaceNames([googleName("Bear Pond Espresso")], "test-model");
    expect(createMock).toHaveBeenCalled();
    expectNoGoogleContent(...capturedMessages(createMock));
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

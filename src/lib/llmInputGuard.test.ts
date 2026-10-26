import { beforeEach, describe, expect, it, vi } from "vitest";
import { capturedMessages, expectNoGoogleContent, googleName } from "@tests/contracts/googleContent";

// ADR-0008 guard: an OpenAI call fed by Google places must leave the
// places' Google content out of the prompt. Fake Google names carry a
// marker (tests/contracts/googleContent.ts); a new call site that sees
// Google places gets a case here. Stop copy, missing copy, name
// translation and the old flow's hint lists no longer reach OpenAI at all.

const createMock = vi.fn();
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
}));

const { suggestFallbackText } = await import("@/lib/stopSuggestionFallback");

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
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { capturedPrompts, replyWith } from "@tests/contracts/llm";
import { expectNoGoogleContent, googleName } from "@tests/contracts/googleContent";

// ADR-0008 guard: an LLM call fed by Google places must leave the
// places' Google content out of the prompt. Fake Google names carry a
// marker (tests/contracts/googleContent.ts); a new call site that sees
// Google places gets a case here. Stop copy, missing copy, name
// translation and the old flow's hint lists no longer reach the model at all.

const generateObject = vi.fn();
vi.mock("@/lib/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/llm")>()),
  generateObject: (req: unknown) => generateObject(req),
}));

const { suggestFallbackText } = await import("@/lib/stopSuggestionFallback");
const { answerChatMessage } = await import("@/lib/chat/assistant");

beforeEach(() => {
  generateObject.mockReset();
});

describe("LLM input carries no Google Maps content (ADR-0008)", () => {
  it("the marker check catches a Google name", () => {
    expect(() => expectNoGoogleContent([{ role: "user", content: googleName("淺草寺") }])).toThrow();
    expect(() => expectNoGoogleContent([{ role: "user", content: "東京，上午，停留約 60 分鐘" }])).not.toThrow();
  });

  // #267: the day's names (Google's) only filter the model's suggestions.
  it("stop picker's text fallback", async () => {
    generateObject.mockImplementationOnce(
      replyWith({ candidates: [
        { name: googleName("淺草寺"), description: "d", duration_minutes: 60 },
        { name: "上野公園", description: "d", duration_minutes: 90 },
      ] })
    );
    const suggestions = await suggestFallbackText("test-model", "東京 5 天", "東京 文化巡禮", [googleName("淺草寺")]);
    expectNoGoogleContent(...capturedPrompts(generateObject));
    expect(suggestions.map((c) => c.name)).toEqual(["上野公園"]);
  });

  // PLAN-004: the trip's Google names, the names on the owner's screen and
  // the Routes times all stay out; a typed name becomes 「第N天第K站」.
  it("chat assistant", async () => {
    generateObject
      .mockImplementationOnce(replyWith({ category: "edit", confident: true }))
      .mockImplementationOnce(replyWith({ reply: "r", actions: [] }));
    const days = [
      {
        id: "d1",
        waypointCity: "東京",
        stops: [{ id: "s1", placeId: "p1", name: googleName("淺草寺"), description: googleName("古寺"), transport_from_prev: googleName("步行") }],
        meals: { dinner: { placeId: "m1", name: googleName("一蘭") } },
        accommodation: { placeId: "h1", name: googleName("飯店"), area: googleName("淺草") },
      },
    ];
    await answerChatMessage({
      message: `把${googleName("淺草寺")}刪掉`,
      days,
      departureDate: "2026-12-01",
      history: [
        { role: "user", content: `${googleName("淺草寺")}幾點去？` },
        { role: "assistant", content: "第1天第1站在上午。" },
      ],
      shownNames: [{ ref: { kind: "stop", stopId: "s1" }, name: googleName("淺草寺") }],
    });
    expect(generateObject).toHaveBeenCalledTimes(2);
    expectNoGoogleContent(...capturedPrompts(generateObject));
  });
});

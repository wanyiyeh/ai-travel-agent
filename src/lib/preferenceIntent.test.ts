import { beforeEach, describe, expect, it, vi } from "vitest";
import { NEUTRAL_PREFERENCE_INTENT } from "@/lib/schemas";

const createMock = vi.fn();

// Mocked so the real @/lib/openai module (which throws at import time if
// OPENAI_API_KEY is unset) never loads — keeps this test hermetic. vi.mock
// calls are hoisted above imports, so this takes effect before the static
// import below resolves @/lib/openai transitively.
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
}));

import { parsePreferenceIntent } from "@/lib/preferenceIntent";

function mockContent(content: string) {
  createMock.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

function mockJson(json: unknown) {
  mockContent(JSON.stringify(json));
}

describe("parsePreferenceIntent", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("returns the neutral intent for empty input without calling the API", async () => {
    const result = await parsePreferenceIntent("   ", "gpt-4o-mini");
    expect(result).toEqual(NEUTRAL_PREFERENCE_INTENT);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("parses a relaxed, late-start, local-food preference", async () => {
    mockJson({
      pace: "relaxed",
      startTimePreference: "late",
      interestBoost: ["local_food"],
      dietaryRestrictions: [],
      avoid: [],
    });
    const result = await parsePreferenceIntent(
      "想放鬆一點、晚點出門、想吃在地小吃",
      "gpt-4o-mini"
    );
    expect(result.pace).toBe("relaxed");
    expect(result.startTimePreference).toBe("late");
    expect(result.interestBoost).toEqual(["local_food"]);
  });

  it("parses an intensive, early-start preference", async () => {
    mockJson({
      pace: "intensive",
      startTimePreference: "early",
      interestBoost: ["history", "architecture"],
      dietaryRestrictions: [],
      avoid: [],
    });
    const result = await parsePreferenceIntent(
      "想早點出門，行程排滿一點，多看點歷史建築",
      "gpt-4o-mini"
    );
    expect(result.pace).toBe("intensive");
    expect(result.startTimePreference).toBe("early");
    expect(result.interestBoost).toEqual(["history", "architecture"]);
  });

  it("parses dietary restrictions and avoid tags", async () => {
    mockJson({
      pace: null,
      startTimePreference: null,
      interestBoost: [],
      dietaryRestrictions: ["vegetarian"],
      avoid: ["crowds"],
    });
    const result = await parsePreferenceIntent(
      "我吃素，想避開人擠人的地方",
      "gpt-4o-mini"
    );
    expect(result.dietaryRestrictions).toEqual(["vegetarian"]);
    expect(result.avoid).toEqual(["crowds"]);
  });

  it("falls back to the neutral intent when the response has no content", async () => {
    mockContent("");
    const result = await parsePreferenceIntent("some text", "gpt-4o-mini");
    expect(result).toEqual(NEUTRAL_PREFERENCE_INTENT);
  });

  it("falls back to the neutral intent when the response is not valid JSON", async () => {
    mockContent("not valid json");
    const result = await parsePreferenceIntent("some text", "gpt-4o-mini");
    expect(result).toEqual(NEUTRAL_PREFERENCE_INTENT);
  });

  it("falls back to the neutral intent when the response fails schema validation", async () => {
    mockJson({ pace: "chill" });
    const result = await parsePreferenceIntent("some text", "gpt-4o-mini");
    expect(result).toEqual(NEUTRAL_PREFERENCE_INTENT);
  });

  it("falls back to the neutral intent when the API call throws", async () => {
    createMock.mockRejectedValueOnce(new Error("API down"));
    const result = await parsePreferenceIntent("some text", "gpt-4o-mini");
    expect(result).toEqual(NEUTRAL_PREFERENCE_INTENT);
  });
});

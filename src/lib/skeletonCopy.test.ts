import { beforeEach, describe, expect, it, vi } from "vitest";
import { NEUTRAL_PREFERENCE_INTENT } from "@/lib/schemas";
import type { RestaurantHint } from "@/lib/fetchCityRestaurants";
import type { SkeletonStop } from "@/lib/scheduler/buildDaySkeleton";

const createMock = vi.fn();

// Mocked so the real @/lib/openai module (which throws at import time if
// OPENAI_API_KEY is unset) never loads — keeps this test hermetic, same
// approach as preferenceIntent.test.ts.
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
}));

import { generateSkeletonCopy } from "@/lib/skeletonCopy";

function mockContent(content: string) {
  createMock.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

function mockJson(json: unknown) {
  mockContent(JSON.stringify(json));
}

function stop(id: string, overrides: Partial<SkeletonStop> = {}): SkeletonStop {
  return {
    id,
    time_of_day: "morning",
    estimatedDurationMinutes: 60,
    startMinute: 480,
    endMinute: 540,
    lat: 35,
    lng: 139,
    ...overrides,
  };
}

describe("generateSkeletonCopy", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("returns an empty result for an empty skeleton without calling the API", async () => {
    const result = await generateSkeletonCopy([], new Map(), NEUTRAL_PREFERENCE_INTENT, "gpt-4o-mini");
    expect(result).toEqual({ stops: {} });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("uses the model's description/highlight and dayTheme when the response is valid", async () => {
    mockJson({
      dayTheme: "歷史古蹟一日遊",
      stops: {
        a: { description: "淺草寺是東京最古老的寺廟。", highlight: "雷門大燈籠" },
      },
    });
    const result = await generateSkeletonCopy(
      [stop("a")],
      new Map<string, RestaurantHint>([["a", { name: "淺草寺" }]]),
      NEUTRAL_PREFERENCE_INTENT,
      "gpt-4o-mini"
    );
    expect(result.dayTheme).toBe("歷史古蹟一日遊");
    expect(result.stops.a).toEqual({ description: "淺草寺是東京最古老的寺廟。", highlight: "雷門大燈籠" });
  });

  it("falls back only the stops the model's response left out, keeping the rest", async () => {
    mockJson({ stops: { a: { description: "real copy for a" } } });
    const result = await generateSkeletonCopy(
      [stop("a"), stop("b")],
      new Map<string, RestaurantHint>([["a", { name: "A" }], ["b", { name: "B地點" }]]),
      NEUTRAL_PREFERENCE_INTENT,
      "gpt-4o-mini"
    );
    expect(result.stops.a.description).toBe("real copy for a");
    expect(result.stops.b.description).toBe("前往 B地點。");
  });

  it("falls back every stop when the response fails schema validation", async () => {
    mockJson({ stops: { a: { description: 123 } } }); // description must be a string
    const result = await generateSkeletonCopy(
      [stop("a")],
      new Map<string, RestaurantHint>([["a", { name: "A地點" }]]),
      NEUTRAL_PREFERENCE_INTENT,
      "gpt-4o-mini"
    );
    expect(result.stops.a.description).toBe("前往 A地點。");
  });

  it("falls back every stop when the response is not valid JSON", async () => {
    mockContent("not valid json");
    const result = await generateSkeletonCopy(
      [stop("a")],
      new Map<string, RestaurantHint>([["a", { name: "A地點" }]]),
      NEUTRAL_PREFERENCE_INTENT,
      "gpt-4o-mini"
    );
    expect(result.stops.a.description).toBe("前往 A地點。");
  });

  it("falls back every stop when the API call throws", async () => {
    createMock.mockRejectedValueOnce(new Error("API down"));
    const result = await generateSkeletonCopy(
      [stop("a")],
      new Map<string, RestaurantHint>([["a", { name: "A地點" }]]),
      NEUTRAL_PREFERENCE_INTENT,
      "gpt-4o-mini"
    );
    expect(result.stops.a.description).toBe("前往 A地點。");
  });

  it("uses a generic id-based fallback when the hint has no matching entry", async () => {
    createMock.mockRejectedValueOnce(new Error("API down"));
    const result = await generateSkeletonCopy([stop("mystery-id")], new Map(), NEUTRAL_PREFERENCE_INTENT, "gpt-4o-mini");
    expect(result.stops["mystery-id"].description).toBe("前往下一個景點（mystery-id）。");
  });

  it("ignores extra ids the model invents that aren't in the skeleton", async () => {
    mockJson({
      stops: {
        a: { description: "real copy for a" },
        "made-up-id": { description: "this should never appear" },
      },
    });
    const result = await generateSkeletonCopy(
      [stop("a")],
      new Map<string, RestaurantHint>([["a", { name: "A" }]]),
      NEUTRAL_PREFERENCE_INTENT,
      "gpt-4o-mini"
    );
    expect(Object.keys(result.stops)).toEqual(["a"]);
  });
});

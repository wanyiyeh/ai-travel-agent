import { describe, it, expect } from "vitest";
import { isRecentEnrichFailure, enrichFailureMarker, ENRICH_FAILURE_RETRY_MS } from "./enrichFailure";

const NOW = Date.parse("2026-09-28T00:00:00Z");

describe("isRecentEnrichFailure", () => {
  it("is false when the item has no marker", () => {
    expect(isRecentEnrichFailure({}, "晚餐 里斯本", NOW)).toBe(false);
    expect(isRecentEnrichFailure(undefined, "晚餐 里斯本", NOW)).toBe(false);
  });

  it("is true for a fresh marker with the same query", () => {
    const item = { enrichFailure: enrichFailureMarker("晚餐 里斯本", "not_found", NOW - 1000) };
    expect(isRecentEnrichFailure(item, "晚餐 里斯本", NOW)).toBe(true);
  });

  it("is false once the query changes (item renamed / moved city)", () => {
    const item = { enrichFailure: enrichFailureMarker("晚餐 里斯本", "not_found", NOW - 1000) };
    expect(isRecentEnrichFailure(item, "Time Out Market 里斯本", NOW)).toBe(false);
  });

  it("is false once the retry window has passed", () => {
    const item = { enrichFailure: enrichFailureMarker("晚餐 里斯本", "too_far", NOW - ENRICH_FAILURE_RETRY_MS) };
    expect(isRecentEnrichFailure(item, "晚餐 里斯本", NOW)).toBe(false);
  });

  it("ignores a malformed marker", () => {
    expect(isRecentEnrichFailure({ enrichFailure: { query: "x", at: "not a date" } }, "x", NOW)).toBe(false);
    expect(isRecentEnrichFailure({ enrichFailure: "x" }, "x", NOW)).toBe(false);
  });
});

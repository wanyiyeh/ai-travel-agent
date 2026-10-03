import { afterEach, describe, expect, it, vi } from "vitest";
import { recordGoogleCall, recordOpenAICall, runMetered } from "./usageMeter";

afterEach(() => vi.restoreAllMocks());

function captureLog() {
  return vi.spyOn(console, "info").mockImplementation(() => {});
}

describe("runMetered", () => {
  it("tallies Google calls by endpoint + field mask and OpenAI tokens, then logs once", async () => {
    const log = captureLog();
    await runMetered("test", async () => {
      const mask = { headers: { "X-Goog-FieldMask": "places.id,places.location" } };
      recordGoogleCall("https://places.googleapis.com/v1/places:searchText", mask);
      recordGoogleCall("https://places.googleapis.com/v1/places:searchText", mask);
      recordGoogleCall("https://places.googleapis.com/v1/places:searchNearby", { headers: { "X-Goog-FieldMask": "places.rating" } });
      recordOpenAICall({ prompt_tokens: 100, completion_tokens: 20 });
      recordOpenAICall(null);
    });

    expect(log).toHaveBeenCalledTimes(1);
    const summary = JSON.parse(String(log.mock.calls[0][0]).replace("[usage] test ", ""));
    expect(summary.googleTotal).toBe(3);
    expect(summary.google["textSearch [places.id,places.location]"]).toBe(2);
    expect(summary.google["nearbySearch [places.rating]"]).toBe(1);
    expect(summary.openai).toEqual({ calls: 2, promptTokens: 100, completionTokens: 20 });
  });

  it("keeps concurrent runs separate", async () => {
    const log = captureLog();
    await Promise.all([
      runMetered("a", async () => { recordOpenAICall(null); await new Promise((r) => setTimeout(r, 5)); recordOpenAICall(null); }),
      runMetered("b", async () => { recordOpenAICall(null); }),
    ]);
    const byLabel = Object.fromEntries(log.mock.calls.map((c) => {
      const [, label, json] = /^\[usage\] (\S+) (.*)$/.exec(String(c[0]))!;
      return [label, JSON.parse(json)];
    }));
    expect(byLabel.a.openai.calls).toBe(2);
    expect(byLabel.b.openai.calls).toBe(1);
  });

  it("records nothing outside a metered run", () => {
    const log = captureLog();
    recordGoogleCall("https://places.googleapis.com/v1/places:searchText");
    recordOpenAICall(null);
    expect(log).not.toHaveBeenCalled();
  });

  it("still logs when the run throws", async () => {
    const log = captureLog();
    await expect(runMetered("boom", async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(log).toHaveBeenCalledTimes(1);
  });
});

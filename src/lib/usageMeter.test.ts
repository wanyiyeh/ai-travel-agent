import { afterEach, describe, expect, it, vi } from "vitest";
import { recordGoogleCall, recordLlmCall, runMetered } from "./usageMeter";

afterEach(() => vi.restoreAllMocks());

function captureLog() {
  return vi.spyOn(console, "info").mockImplementation(() => {});
}

describe("runMetered", () => {
  it("tallies Google calls by endpoint + field mask and LLM tokens, then logs once", async () => {
    const log = captureLog();
    await runMetered("test", async () => {
      const mask = { headers: { "X-Goog-FieldMask": "places.id,places.location" } };
      recordGoogleCall("https://places.googleapis.com/v1/places:searchText", mask);
      recordGoogleCall("https://places.googleapis.com/v1/places:searchText", mask);
      recordGoogleCall("https://places.googleapis.com/v1/places:searchNearby", { headers: { "X-Goog-FieldMask": "places.rating" } });
      recordLlmCall({ inputTokens: 100, outputTokens: 20 });
      recordLlmCall(null);
    });

    expect(log).toHaveBeenCalledTimes(1);
    const summary = JSON.parse(String(log.mock.calls[0][0]).replace("[usage] test ", ""));
    expect(summary.googleTotal).toBe(3);
    expect(summary.google["textSearch [places.id,places.location]"]).toBe(2);
    expect(summary.google["nearbySearch [places.rating]"]).toBe(1);
    expect(summary.llm).toEqual({ calls: 2, inputTokens: 100, outputTokens: 20 });
  });

  it("keeps concurrent runs separate", async () => {
    const log = captureLog();
    await Promise.all([
      runMetered("a", async () => { recordLlmCall(null); await new Promise((r) => setTimeout(r, 5)); recordLlmCall(null); }),
      runMetered("b", async () => { recordLlmCall(null); }),
    ]);
    const byLabel = Object.fromEntries(log.mock.calls.map((c) => {
      const [, label, json] = /^\[usage\] (\S+) (.*)$/.exec(String(c[0]))!;
      return [label, JSON.parse(json)];
    }));
    expect(byLabel.a.llm.calls).toBe(2);
    expect(byLabel.b.llm.calls).toBe(1);
  });

  it("records nothing outside a metered run", () => {
    const log = captureLog();
    recordGoogleCall("https://places.googleapis.com/v1/places:searchText");
    recordLlmCall(null);
    expect(log).not.toHaveBeenCalled();
  });

  it("still logs what a run called when it throws", async () => {
    const log = captureLog();
    await expect(
      runMetered("boom", async () => {
        recordGoogleCall("https://places.googleapis.com/v1/places:searchText");
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("logs nothing for a run that called nothing", async () => {
    const log = captureLog();
    await runMetered("idle", async () => {});
    expect(log).not.toHaveBeenCalled();
  });
});

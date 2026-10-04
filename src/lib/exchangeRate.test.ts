import { afterEach, describe, expect, it, vi } from "vitest";
import { getTwdRates, resetTwdRatesCache } from "./exchangeRate";

const ok = (rates: Record<string, number>) =>
  new Response(JSON.stringify({ result: "success", rates }), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  resetTwdRatesCache();
});

describe("getTwdRates", () => {
  it("inverts the API's per-TWD rates into NT$ per unit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ TWD: 1, JPY: 5, USD: 0.03125 })));
    const rates = await getTwdRates();
    expect(rates.JPY).toBeCloseTo(0.2);
    expect(rates.USD).toBeCloseTo(32);
    expect(rates.TWD).toBe(1);
  });

  it("fetches once and serves later calls from memory", async () => {
    const fetchMock = vi.fn(async () => ok({ JPY: 5 }));
    vi.stubGlobal("fetch", fetchMock);
    await getTwdRates();
    await getTwdRates();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to TWD only on an upstream failure, without caching the failure", async () => {
    const fetchMock = vi.fn(async () => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getTwdRates()).toEqual({ TWD: 1 });
    await getTwdRates();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

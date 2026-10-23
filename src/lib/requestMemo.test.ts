import { describe, expect, it, vi } from "vitest";
import { memoizeInRequest, memoizeSuccessInRequest, peekRequestMemo, withRequestMemo } from "./requestMemo";

describe("requestMemo", () => {
  it("answers a repeat within the request once, and forgets it after", async () => {
    const fetch = vi.fn(async () => "pool");

    await withRequestMemo(async () => {
      expect(await memoizeInRequest("k", fetch)).toBe("pool");
      expect(await memoizeInRequest("k", fetch)).toBe("pool");
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    await withRequestMemo(() => memoizeInRequest("k", fetch));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares a call still in flight", async () => {
    const fetch = vi.fn(async () => "pool");

    await withRequestMemo(() => Promise.all([memoizeInRequest("k", fetch), memoizeInRequest("k", fetch)]));

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("runs every call outside a request", async () => {
    const fetch = vi.fn(async () => "pool");

    await memoizeInRequest("k", fetch);
    await memoizeInRequest("k", fetch);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(peekRequestMemo("k")).toBeUndefined();
  });

  it("keeps an empty result but retries a failed one", async () => {
    const empty = vi.fn(async () => [] as string[]);
    const failed = vi.fn(async () => undefined);

    await withRequestMemo(async () => {
      expect(await memoizeSuccessInRequest("empty", empty)).toEqual([]);
      expect(await memoizeSuccessInRequest("empty", empty)).toEqual([]);
      expect(await memoizeSuccessInRequest("failed", failed)).toBeUndefined();
      expect(await memoizeSuccessInRequest("failed", failed)).toBeUndefined();
    });

    expect(empty).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it("joins an outer request instead of starting a new one", async () => {
    const fetch = vi.fn(async () => "pool");

    await withRequestMemo(async () => {
      await memoizeInRequest("k", fetch);
      await withRequestMemo(() => memoizeInRequest("k", fetch));
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

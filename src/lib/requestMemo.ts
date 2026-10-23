import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Repeats of the same Google lookup within one request (several days'
 * meals searching the same city center, a route leg asked for twice) are
 * answered once. Nothing outlives the request: the Google terms don't let
 * results be cached (ADR-0004), so the old *Cache tables for candidate pools,
 * route legs and nearest stations are no longer written.
 *
 * Request boundaries are set by runMetered (usageMeter.ts); outside one,
 * every call simply runs.
 */

const storage = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function withRequestMemo<T>(fn: () => Promise<T>): Promise<T> {
  return storage.getStore() ? fn() : storage.run(new Map(), fn);
}

/** The result for `key` from earlier in this request, or `fetch`'s. A failure isn't kept. */
export function memoizeInRequest<T>(key: string, fetch: () => Promise<T>): Promise<T> {
  const memo = storage.getStore();
  if (!memo) return fetch();
  const existing = memo.get(key);
  if (existing) return existing as Promise<T>;
  const pending = fetch();
  memo.set(key, pending);
  pending.catch(() => memo.delete(key));
  return pending;
}

const FAILED = Symbol("failed");

/**
 * memoizeInRequest for fetchers that report a failed call as undefined
 * instead of throwing. A failure isn't kept, so the next call retries; a
 * confirmed empty result (an empty list, a null) is.
 */
export async function memoizeSuccessInRequest<T>(key: string, fetch: () => Promise<T | undefined>): Promise<T | undefined> {
  try {
    return await memoizeInRequest(key, async () => {
      const result = await fetch();
      if (result === undefined) throw FAILED;
      return result;
    });
  } catch (err) {
    if (err === FAILED) return undefined;
    throw err;
  }
}

/** What this request already has for `key`, without fetching. */
export function peekRequestMemo<T>(key: string): Promise<T> | undefined {
  return storage.getStore()?.get(key) as Promise<T> | undefined;
}

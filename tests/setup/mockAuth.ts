import { afterEach, vi } from "vitest";

// Tests never run the real Auth.js flow (it needs Next's runtime and Google),
// and next/headers' cookies() only works inside a real request. Every test
// file sees mocked versions of both:
//   - "@/auth": the session is whatever the test set with signInAs().
//   - "next/headers": cookies() reads/writes an in-memory jar the test can
//     seed with setTestCookie() (e.g. a signed guest cookie).
// Both reset after each test (signed out, no cookies). Files that need
// different behavior can still vi.mock either module themselves.

type TestSession = { user: { id: string; email: string } } | null;

const state = globalThis as unknown as {
  __testSession?: TestSession;
  __testCookies?: Map<string, string>;
};
state.__testCookies ??= new Map();

export function signInAs(user: { id: string; email: string } | null) {
  state.__testSession = user ? { user } : null;
}

export function setTestCookie(name: string, value: string | null) {
  if (value === null) state.__testCookies!.delete(name);
  else state.__testCookies!.set(name, value);
}

export function getTestCookie(name: string): string | undefined {
  return state.__testCookies!.get(name);
}

vi.mock("@/auth", () => ({
  auth: async () => state.__testSession ?? null,
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = state.__testCookies!.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void state.__testCookies!.set(name, value),
    delete: (name: string) => void state.__testCookies!.delete(name),
  }),
  headers: async () => new Headers(),
}));

afterEach(() => {
  state.__testSession = null;
  state.__testCookies!.clear();
});

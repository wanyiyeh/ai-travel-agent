import { afterEach, vi } from "vitest";

// Tests never run the real Auth.js flow (it needs Next's runtime and Google).
// Every test file sees a mocked "@/auth" whose session is whatever the test
// set with signInAs() — signed out by default, reset after each test.
// Files that need different behavior can still vi.mock("@/auth") themselves.

type TestSession = { user: { id: string; email: string } } | null;

const state = globalThis as unknown as { __testSession?: TestSession };

export function signInAs(user: { id: string; email: string } | null) {
  state.__testSession = user ? { user } : null;
}

vi.mock("@/auth", () => ({
  auth: async () => state.__testSession ?? null,
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

afterEach(() => {
  state.__testSession = null;
});

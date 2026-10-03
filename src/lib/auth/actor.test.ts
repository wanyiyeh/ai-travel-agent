import { describe, expect, it, vi } from "vitest";

// actor.ts imports @/auth (NextAuth config); only the pure mapping is tested here.
vi.mock("@/auth", () => ({ auth: async () => null }));

const { actorFromSession } = await import("./actor");

describe("actorFromSession", () => {
  it("is null when signed out or the session lacks our user id", () => {
    expect(actorFromSession(null)).toBeNull();
    expect(actorFromSession({ user: { email: "a@b.com" } })).toBeNull();
  });

  it("maps a session to a user actor and flags admins from ADMIN_EMAILS", () => {
    vi.stubEnv("ADMIN_EMAILS", "boss@gmail.com");
    expect(actorFromSession({ user: { id: "u1", email: "Boss@gmail.com" } })).toEqual({
      kind: "user", userId: "u1", email: "Boss@gmail.com", isAdmin: true,
    });
    expect(actorFromSession({ user: { id: "u2", email: "guest@gmail.com" } })?.isAdmin).toBe(false);
    vi.unstubAllEnvs();
  });
});

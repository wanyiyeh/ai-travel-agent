import { afterEach, describe, expect, it, vi } from "vitest";
import { GUEST_TTL_MS, guestCookieHeader, guestExpiry, signGuestId, verifyGuestCookie } from "./guest";

afterEach(() => vi.unstubAllEnvs());

describe("guest cookie signing", () => {
  it("round-trips a signed id", () => {
    vi.stubEnv("AUTH_SECRET", "secret-a");
    expect(verifyGuestCookie(signGuestId("guest-123"))).toBe("guest-123");
  });

  it("rejects a cookie pointed at another id, a tampered mac, or garbage", () => {
    vi.stubEnv("AUTH_SECRET", "secret-a");
    const [, mac] = signGuestId("guest-123").split(".");
    expect(verifyGuestCookie(`guest-999.${mac}`)).toBeNull();
    expect(verifyGuestCookie(`guest-123.${mac.slice(0, -1)}x`)).toBeNull();
    expect(verifyGuestCookie("guest-123")).toBeNull();
    expect(verifyGuestCookie(".abc")).toBeNull();
    expect(verifyGuestCookie("")).toBeNull();
    expect(verifyGuestCookie(undefined)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", () => {
    vi.stubEnv("AUTH_SECRET", "secret-a");
    const cookie = signGuestId("guest-123");
    vi.stubEnv("AUTH_SECRET", "secret-b");
    expect(verifyGuestCookie(cookie)).toBeNull();
  });

  it("sets an httpOnly, SameSite cookie that lives as long as a guest itinerary", () => {
    vi.stubEnv("AUTH_SECRET", "secret-a");
    const header = guestCookieHeader("guest-123");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain(`Max-Age=${GUEST_TTL_MS / 1000}`);
    expect(header).not.toContain("Secure"); // only in production
  });

  it("expires guest itineraries three days out", () => {
    expect(guestExpiry(0).getTime()).toBe(3 * 24 * 60 * 60 * 1000);
  });
});

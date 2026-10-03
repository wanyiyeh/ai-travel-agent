import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "./turnstile";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubSiteverify(response: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("verifyTurnstileToken", () => {
  it("passes when Cloudflare confirms the token, sending secret, token and client IP", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const fetchMock = stubSiteverify({ success: true });
    expect(await verifyTurnstileToken("tok", "203.0.113.1")).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("secret");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("203.0.113.1");
  });

  it("fails on a rejected, missing, or unverifiable token", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    stubSiteverify({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyTurnstileToken("bad")).toEqual({ ok: false, reason: "invalid-input-response" });
    expect(await verifyTurnstileToken(undefined)).toEqual({ ok: false, reason: "missing_token" });

    stubSiteverify({}, 500);
    expect((await verifyTurnstileToken("tok")).ok).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await verifyTurnstileToken("tok")).toEqual({ ok: false, reason: "siteverify_unreachable" });
  });

  it("is skipped without a secret in dev, but fails closed in production", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    expect((await verifyTurnstileToken(undefined)).ok).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(await verifyTurnstileToken("tok")).toEqual({ ok: false, reason: "not_configured" });
  });
});

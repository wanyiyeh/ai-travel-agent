import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, buildSecurityHeaders } from "./securityHeaders";

const byKey = (headers: { key: string; value: string }[]) => Object.fromEntries(headers.map((h) => [h.key, h.value]));

describe("buildSecurityHeaders", () => {
  it("ships CSP as report-only until explicitly enforced", () => {
    const reportOnly = byKey(buildSecurityHeaders({ isDev: true, enforceCsp: false }));
    expect(reportOnly["Content-Security-Policy-Report-Only"]).toBeDefined();
    expect(reportOnly["Content-Security-Policy"]).toBeUndefined();

    const enforced = byKey(buildSecurityHeaders({ isDev: true, enforceCsp: true }));
    expect(enforced["Content-Security-Policy"]).toBeDefined();
  });

  it("always sets the basic hardening headers", () => {
    const h = byKey(buildSecurityHeaders({ isDev: true, enforceCsp: false }));
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("geolocation=()");
  });

  it("adds HSTS only outside dev", () => {
    expect(byKey(buildSecurityHeaders({ isDev: true, enforceCsp: false }))["Strict-Transport-Security"]).toBeUndefined();
    expect(byKey(buildSecurityHeaders({ isDev: false, enforceCsp: false }))["Strict-Transport-Security"]).toContain("max-age=");
  });
});

describe("buildContentSecurityPolicy", () => {
  it("forbids framing and plugins", () => {
    const csp = buildContentSecurityPolicy(false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("allows Google Maps and place photo hosts", () => {
    const csp = buildContentSecurityPolicy(false);
    expect(csp).toMatch(/script-src [^;]*https:\/\/\*\.googleapis\.com/);
    expect(csp).toMatch(/img-src [^;]*https:\/\/\*\.googleusercontent\.com/);
  });

  it("allows the HMR websocket only in dev", () => {
    expect(buildContentSecurityPolicy(true)).toMatch(/connect-src [^;]*ws:/);
    expect(buildContentSecurityPolicy(false)).not.toMatch(/connect-src [^;]*ws:/);
  });
});

describe("CSP and Google sign-in", () => {
  it("lets the sign-in form redirect to Google's consent page", () => {
    expect(buildContentSecurityPolicy(false)).toMatch(/form-action 'self' https:\/\/accounts\.google\.com/);
  });
});

describe("CSP and Turnstile", () => {
  it("allows the Turnstile script and its challenge iframe", () => {
    const csp = buildContentSecurityPolicy(false);
    expect(csp).toMatch(/script-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/challenges\.cloudflare\.com/);
  });
});

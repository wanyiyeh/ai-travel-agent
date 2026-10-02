import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/securityHeaders";

const securityHeaders = buildSecurityHeaders({
  isDev: process.env.NODE_ENV !== "production",
  // Flip to enforcing once a stretch of normal use shows no CSP violations
  // in the browser console (plan/security-hardening.md Phase 4).
  enforceCsp: process.env.CSP_ENFORCE === "1",
});

const nextConfig: NextConfig = {
  // Don't advertise the framework in every response.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

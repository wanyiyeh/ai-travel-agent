import { createHmac } from "node:crypto";
import { clientIp } from "@/lib/rateLimit";

// The browser's id for the per-device quota, issued by proxy.ts.
export const DEVICE_COOKIE = "device_id";
export const DEVICE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

export interface RequestFingerprint {
  ipHash: string;
  deviceId: string | null;
}

// The client IP is only ever stored as a keyed hash: still comparable
// ("same IP?"), but a leaked DB doesn't leak visitors' IPs.
export function hashIp(ip: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required to hash client IPs");
  return createHmac("sha256", secret).update(`ip:${ip}`).digest("base64url");
}

// IP hash + device id for quota counting. device_id is issued by proxy.ts on
// the first API request, so it's normally present by the time a route runs.
export function requestFingerprint(request: Request): RequestFingerprint {
  const cookie = request.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)device_id=([^;]+)/.exec(cookie);
  return { ipHash: hashIp(clientIp(request.headers)), deviceId: match ? decodeURIComponent(match[1]) : null };
}

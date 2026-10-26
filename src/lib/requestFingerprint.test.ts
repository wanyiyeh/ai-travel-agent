import { describe, expect, it } from "vitest";
import { hashIp, requestFingerprint } from "./requestFingerprint";

const withCookie = (cookie: string) =>
  new Request("http://test/api", { headers: { cookie, "x-forwarded-for": "203.0.113.20" } });

// Story: browsers join cookies with "; ", and device_id is rarely the first
// one, so the per-device quota saw no device at all (#280).
describe("requestFingerprint", () => {
  it("reads device_id wherever it is in the Cookie header", () => {
    expect(requestFingerprint(withCookie("device_id=dev-1")).deviceId).toBe("dev-1");
    expect(requestFingerprint(withCookie("guest_id=g.sig; device_id=dev-2")).deviceId).toBe("dev-2");
    expect(requestFingerprint(withCookie("a=1;device_id=dev-3; b=2")).deviceId).toBe("dev-3");
  });

  it("doesn't take another cookie that merely ends in device_id", () => {
    expect(requestFingerprint(withCookie("old_device_id=x")).deviceId).toBeNull();
  });

  it("has no device without the cookie, and hashes the IP", () => {
    const fingerprint = requestFingerprint(withCookie("guest_id=g.sig"));
    expect(fingerprint.deviceId).toBeNull();
    expect(fingerprint.ipHash).toBe(hashIp("203.0.113.20"));
  });
});

// Cloudflare Turnstile (CAPTCHA) check before a trip generation, to stop
// scripted bulk generation (plan/access-control.md §3, layer 5). The browser
// widget yields a single-use token; the server confirms it with Cloudflare.
// Siteverify is free and isn't a Google/OpenAI call.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = { ok: true } | { ok: false; reason: string };

export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstileToken(token: string | undefined, remoteIp?: string): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Lets local dev / CI run without Cloudflare keys. In production a
    // missing key must fail closed, not silently turn the check off.
    if (process.env.NODE_ENV === "production") return { ok: false, reason: "not_configured" };
    return { ok: true };
  }
  if (!token) return { ok: false, reason: "missing_token" };

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
    if (!res.ok) return { ok: false, reason: `siteverify_http_${res.status}` };
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return data.success ? { ok: true } : { ok: false, reason: (data["error-codes"] ?? ["rejected"]).join(",") };
  } catch {
    // Fail closed: if Cloudflare can't be reached, no paid generation runs.
    return { ok: false, reason: "siteverify_unreachable" };
  }
}

export function captchaFailedResponse() {
  return Response.json(
    { error: "人機驗證沒有通過，請重新整理頁面後再試一次。", code: "captcha_failed" },
    { status: 403 },
  );
}

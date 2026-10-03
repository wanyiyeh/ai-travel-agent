// ADMIN_EMAILS: comma-separated list of Google account emails with no usage
// limits that can also mark itineraries public (plan/access-control.md §2).
// Compared case-insensitively; Google emails are case-insensitive.

export function parseEmailList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().replace(/^["']|["']$/g, "").toLowerCase())
      .filter(Boolean),
  );
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAdminEmail(email: string, raw = process.env.ADMIN_EMAILS): boolean {
  return parseEmailList(raw).has(normalizeEmail(email));
}

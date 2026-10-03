import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { requestFingerprint, type RequestFingerprint } from "@/lib/requestFingerprint";

// Daily usage quotas for anything that costs money (plan/access-control.md
// §2–§4). Counted from UsageEvent rows over a rolling 24h window, so they
// survive restarts — unlike the in-memory burst limits in rateLimit.ts, which
// stay in front of this as the first line.
//
// Layers, all of which must pass:
//   per account   guest: 1 generation ever, 5 paid edits per itinerary;
//                 user: 5 generations/day (2 in the account's first 3 days),
//                 30 paid edits/day
//   per IP        across all accounts on that IP (multi-account defense)
//   per device    across all accounts in that browser (device_id cookie)
//   site-wide     total generations/day, so the worst case is bounded no
//                 matter how many accounts or IPs are used
// Admins skip all of it (the site-wide daily call budget in dailyBudget.ts
// still applies to them).
//
// Check-then-record isn't atomic: two requests racing could each pass at the
// limit. generate-stream's one-at-a-time gate per IP keeps that to the edge
// case, and the site-wide caps bound it either way.

export type UsageKind = "generate" | "paid_edit";

const DAY_MS = 24 * 60 * 60 * 1000;
export const NEW_ACCOUNT_MS = 3 * DAY_MS;

export const QUOTAS = {
  generate: {
    guestLifetime: 1,
    userPerDay: 5,
    newUserPerDay: 2,
    perIpPerDay: 10,
    guestPerIpPerDay: 2,
    perDevicePerDay: 5,
    siteGuestPerDay: 5,
    siteUserPerDay: 15,
  },
  paid_edit: {
    guestPerItinerary: 5,
    userPerDay: 30,
    perIpPerDay: 60,
  },
} as const;

// What the caller is, for quota purposes. A signed-out visitor who is about
// to become a guest has no userId yet.
export type QuotaSubject =
  | { kind: "admin" }
  | { kind: "user"; userId: string; accountCreatedAt: Date; disabled: boolean }
  | { kind: "guest"; userId: string | null };

export interface UsageCounts {
  // generate
  subjectGenerationsEver?: number; // guests only
  subjectGenerationsToday?: number;
  ipGenerationsToday: number;
  ipGuestGenerationsToday: number;
  deviceGenerationsToday: number;
  siteGuestGenerationsToday: number;
  siteUserGenerationsToday: number;
  // paid_edit
  subjectEditsToday?: number;
  itineraryEditsByGuest?: number;
  ipEditsToday?: number;
}

export type QuotaDecision = { ok: true } | { ok: false; reason: string; message: string };

const deny = (reason: string, message: string): QuotaDecision => ({ ok: false, reason, message });

// Pure: the whole policy, given the counts. Unit-tested layer by layer.
export function evaluateQuota(subject: QuotaSubject, kind: UsageKind, c: UsageCounts, now = Date.now()): QuotaDecision {
  if (subject.kind === "admin") return { ok: true };
  if (subject.kind === "user" && subject.disabled) {
    return deny("disabled", "這個帳號已被停用。");
  }

  if (kind === "generate") {
    const q = QUOTAS.generate;
    if (subject.kind === "guest") {
      if ((c.subjectGenerationsEver ?? 0) >= q.guestLifetime) {
        return deny("guest_limit", "訪客只能生成 1 個行程，用 Google 登入後每天可以生成更多。");
      }
    } else {
      const isNew = now - subject.accountCreatedAt.getTime() < NEW_ACCOUNT_MS;
      const limit = isNew ? q.newUserPerDay : q.userPerDay;
      if ((c.subjectGenerationsToday ?? 0) >= limit) {
        return deny(
          isNew ? "new_user_daily_limit" : "user_daily_limit",
          isNew
            ? `新帳號前 3 天每天最多生成 ${limit} 個行程，明天再來吧。`
            : `每天最多生成 ${limit} 個行程，明天再來吧。`,
        );
      }
    }
    if (c.ipGenerationsToday >= q.perIpPerDay) {
      return deny("ip_daily_limit", "這個網路今天的生成次數已達上限，請明天再試。");
    }
    if (subject.kind === "guest" && c.ipGuestGenerationsToday >= q.guestPerIpPerDay) {
      return deny("ip_guest_daily_limit", "這個網路今天的訪客生成次數已達上限，用 Google 登入後可以繼續。");
    }
    if (c.deviceGenerationsToday >= q.perDevicePerDay) {
      return deny("device_daily_limit", "這台裝置今天的生成次數已達上限，請明天再試。");
    }
    const siteCount = subject.kind === "guest" ? c.siteGuestGenerationsToday : c.siteUserGenerationsToday;
    const siteLimit = subject.kind === "guest" ? q.siteGuestPerDay : q.siteUserPerDay;
    if (siteCount >= siteLimit) {
      return deny(
        "site_daily_limit",
        subject.kind === "guest"
          ? "今天的訪客名額已滿，用 Google 登入後可以繼續，或明天再來。"
          : "今天的生成名額已滿，請明天再來。",
      );
    }
    return { ok: true };
  }

  const q = QUOTAS.paid_edit;
  if (subject.kind === "guest") {
    if ((c.itineraryEditsByGuest ?? 0) >= q.guestPerItinerary) {
      return deny("guest_edit_limit", `訪客每個行程最多使用 ${q.guestPerItinerary} 次 AI 編輯，用 Google 登入後可以繼續。`);
    }
  } else if ((c.subjectEditsToday ?? 0) >= q.userPerDay) {
    return deny("user_edit_daily_limit", `每天最多使用 ${q.userPerDay} 次 AI 編輯，明天再來吧。`);
  }
  if ((c.ipEditsToday ?? 0) >= q.perIpPerDay) {
    return deny("ip_edit_daily_limit", "這個網路今天的 AI 編輯次數已達上限，請明天再試。");
  }
  return { ok: true };
}

async function loadSubject(actor: Actor | null): Promise<QuotaSubject> {
  if (actor?.isAdmin) return { kind: "admin" };
  if (!actor || actor.kind === "guest") return { kind: "guest", userId: actor?.userId ?? null };
  const user = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { createdAt: true, disabledAt: true },
  });
  return {
    kind: "user",
    userId: actor.userId,
    accountCreatedAt: user?.createdAt ?? new Date(),
    disabled: Boolean(user?.disabledAt),
  };
}

async function countUsage(
  subject: QuotaSubject,
  kind: UsageKind,
  fp: RequestFingerprint,
  itineraryId: string | undefined,
  now: number,
): Promise<UsageCounts> {
  const since = new Date(now - DAY_MS);
  const count = (where: object) => prisma.usageEvent.count({ where: { kind, ...where } });
  const today = { createdAt: { gte: since } };
  const subjectId = subject.kind === "admin" ? null : subject.userId;

  if (kind === "generate") {
    const [ever, mine, ip, ipGuest, device, siteGuest, siteUser] = await Promise.all([
      subject.kind === "guest" && subjectId ? count({ userId: subjectId }) : 0,
      subject.kind === "user" ? count({ userId: subjectId, ...today }) : 0,
      count({ ipHash: fp.ipHash, ...today }),
      count({ ipHash: fp.ipHash, isGuest: true, ...today }),
      fp.deviceId ? count({ deviceId: fp.deviceId, ...today }) : 0,
      count({ isGuest: true, ...today }),
      count({ isGuest: false, ...today }),
    ]);
    return {
      subjectGenerationsEver: ever,
      subjectGenerationsToday: mine,
      ipGenerationsToday: ip,
      ipGuestGenerationsToday: ipGuest,
      deviceGenerationsToday: device,
      siteGuestGenerationsToday: siteGuest,
      siteUserGenerationsToday: siteUser,
    };
  }

  const [mine, perItinerary, ip] = await Promise.all([
    subject.kind === "user" ? count({ userId: subjectId, ...today }) : 0,
    subject.kind === "guest" && itineraryId ? count({ itineraryId, userId: subjectId }) : 0,
    count({ ipHash: fp.ipHash, ...today }),
  ]);
  return {
    subjectEditsToday: mine,
    itineraryEditsByGuest: perItinerary,
    ipEditsToday: ip,
    ipGenerationsToday: 0,
    ipGuestGenerationsToday: 0,
    deviceGenerationsToday: 0,
    siteGuestGenerationsToday: 0,
    siteUserGenerationsToday: 0,
  };
}

export async function checkQuota(
  actor: Actor | null,
  kind: UsageKind,
  fp: RequestFingerprint,
  itineraryId?: string,
  now = Date.now(),
): Promise<QuotaDecision> {
  const subject = await loadSubject(actor);
  if (subject.kind === "admin") return { ok: true };
  return evaluateQuota(subject, kind, await countUsage(subject, kind, fp, itineraryId, now), now);
}

export async function recordUsage(
  kind: UsageKind,
  owner: { userId: string; isGuest: boolean },
  fp: RequestFingerprint,
  itineraryId?: string,
) {
  await prisma.usageEvent.create({
    data: { kind, userId: owner.userId, isGuest: owner.isGuest, ipHash: fp.ipHash, deviceId: fp.deviceId, itineraryId },
  });
}

// Shared 429 body. `error` is the user-facing message (the pickers show
// `error` as-is); `code` lets the client tell quota limits apart.
export function quotaExceededResponse(decision: Extract<QuotaDecision, { ok: false }>) {
  return Response.json(
    { error: decision.message, code: "quota_exceeded", reason: decision.reason },
    { status: 429 },
  );
}

// For the paid-edit routes (plan/access-control.md §2): check the caller's
// quota and record the edit. Returns a 429 response to send back, or null to
// carry on. Call it right before the route's first OpenAI/Google call.
export async function chargePaidEdit(request: Request, actor: Actor, itineraryId: string): Promise<Response | null> {
  const fingerprint = requestFingerprint(request);
  const decision = await checkQuota(actor, "paid_edit", fingerprint, itineraryId);
  if (!decision.ok) return quotaExceededResponse(decision);
  if (!actor.isAdmin) {
    await recordUsage("paid_edit", { userId: actor.userId, isGuest: actor.kind === "guest" }, fingerprint, itineraryId);
  }
  return null;
}

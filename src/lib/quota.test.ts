import { describe, expect, it } from "vitest";
import { NEW_ACCOUNT_MS, QUOTAS, evaluateQuota, type QuotaSubject, type UsageCounts } from "./quota";

const NOW = Date.UTC(2026, 9, 3, 12);
const zero: UsageCounts = {
  subjectGenerationsEver: 0,
  subjectGenerationsToday: 0,
  ipGenerationsToday: 0,
  ipGuestGenerationsToday: 0,
  deviceGenerationsToday: 0,
  siteGuestGenerationsToday: 0,
  siteUserGenerationsToday: 0,
  subjectEditsToday: 0,
  itineraryEditsByGuest: 0,
  ipEditsToday: 0,
};
const guest: QuotaSubject = { kind: "guest", userId: "g1" };
const newGuest: QuotaSubject = { kind: "guest", userId: null };
const oldUser: QuotaSubject = { kind: "user", userId: "u1", accountCreatedAt: new Date(NOW - 30 * 86_400_000), disabled: false };
const newUser: QuotaSubject = { kind: "user", userId: "u2", accountCreatedAt: new Date(NOW - 86_400_000), disabled: false };

const gen = (s: QuotaSubject, c: Partial<UsageCounts>) => evaluateQuota(s, "generate", { ...zero, ...c }, NOW);
const edit = (s: QuotaSubject, c: Partial<UsageCounts>) => evaluateQuota(s, "paid_edit", { ...zero, ...c }, NOW);
const reason = (d: ReturnType<typeof evaluateQuota>) => (d.ok ? "ok" : d.reason);

describe("generation quotas", () => {
  it("lets a fresh guest, a new user and an established user generate", () => {
    expect(reason(gen(newGuest, {}))).toBe("ok");
    expect(reason(gen(newUser, {}))).toBe("ok");
    expect(reason(gen(oldUser, {}))).toBe("ok");
  });

  it("a guest gets one generation, ever", () => {
    expect(reason(gen(guest, { subjectGenerationsEver: 1 }))).toBe("guest_limit");
  });

  it("new accounts get 2 a day for their first 3 days, then 5", () => {
    expect(reason(gen(newUser, { subjectGenerationsToday: 1 }))).toBe("ok");
    expect(reason(gen(newUser, { subjectGenerationsToday: 2 }))).toBe("new_user_daily_limit");
    expect(reason(gen(oldUser, { subjectGenerationsToday: 4 }))).toBe("ok");
    expect(reason(gen(oldUser, { subjectGenerationsToday: 5 }))).toBe("user_daily_limit");

    const justAged: QuotaSubject = { ...newUser, accountCreatedAt: new Date(NOW - NEW_ACCOUNT_MS) } as QuotaSubject;
    expect(reason(gen(justAged, { subjectGenerationsToday: 2 }))).toBe("ok");
  });

  it("one IP shares a cap across every account on it, tighter for guests", () => {
    expect(reason(gen(oldUser, { ipGenerationsToday: QUOTAS.generate.perIpPerDay }))).toBe("ip_daily_limit");
    expect(reason(gen(newGuest, { ipGuestGenerationsToday: QUOTAS.generate.guestPerIpPerDay }))).toBe("ip_guest_daily_limit");
    // Guest generations on the IP don't block a signed-in user there.
    expect(reason(gen(oldUser, { ipGuestGenerationsToday: QUOTAS.generate.guestPerIpPerDay }))).toBe("ok");
  });

  it("one browser shares a cap across every account used in it", () => {
    expect(reason(gen(oldUser, { deviceGenerationsToday: QUOTAS.generate.perDevicePerDay }))).toBe("device_daily_limit");
  });

  it("site-wide caps hold no matter how many accounts or IPs are used", () => {
    expect(reason(gen(newGuest, { siteGuestGenerationsToday: QUOTAS.generate.siteGuestPerDay }))).toBe("site_daily_limit");
    expect(reason(gen(oldUser, { siteUserGenerationsToday: QUOTAS.generate.siteUserPerDay }))).toBe("site_daily_limit");
    // The guest pool filling up doesn't lock out signed-in users, and vice versa.
    expect(reason(gen(oldUser, { siteGuestGenerationsToday: 99 }))).toBe("ok");
    expect(reason(gen(newGuest, { siteUserGenerationsToday: 99 }))).toBe("ok");
  });

  it("admins skip every limit; disabled accounts are refused outright", () => {
    expect(reason(gen({ kind: "admin" }, { ipGenerationsToday: 999, siteUserGenerationsToday: 999 }))).toBe("ok");
    expect(reason(gen({ ...oldUser, disabled: true } as QuotaSubject, {}))).toBe("disabled");
    expect(reason(edit({ ...oldUser, disabled: true } as QuotaSubject, {}))).toBe("disabled");
  });

  it("explains the limit in Chinese for the UI", () => {
    const d = gen(guest, { subjectGenerationsEver: 1 });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.message).toContain("登入");
  });
});

describe("paid edit quotas", () => {
  it("a guest gets 5 per itinerary", () => {
    expect(reason(edit(guest, { itineraryEditsByGuest: 4 }))).toBe("ok");
    expect(reason(edit(guest, { itineraryEditsByGuest: 5 }))).toBe("guest_edit_limit");
  });

  it("a user gets 30 a day, and an IP 60 a day across accounts", () => {
    expect(reason(edit(oldUser, { subjectEditsToday: 29 }))).toBe("ok");
    expect(reason(edit(oldUser, { subjectEditsToday: 30 }))).toBe("user_edit_daily_limit");
    expect(reason(edit(oldUser, { ipEditsToday: 60 }))).toBe("ip_edit_daily_limit");
  });
});

describe("chat quotas", () => {
  const chat = (s: QuotaSubject, c: Partial<UsageCounts>) => evaluateQuota(s, "chat", { ...zero, ...c }, NOW);
  const q = QUOTAS.chat;

  it("is for signed-in owners only", () => {
    expect(reason(chat(guest, {}))).toBe("guest_chat");
  });

  it("gives a new account fewer messages a day", () => {
    expect(reason(chat(newUser, { subjectChatsToday: q.newUserPerDay - 1 }))).toBe("ok");
    expect(reason(chat(newUser, { subjectChatsToday: q.newUserPerDay }))).toBe("chat_daily_limit");
    expect(reason(chat(oldUser, { subjectChatsToday: q.userPerDay - 1 }))).toBe("ok");
    expect(reason(chat(oldUser, { subjectChatsToday: q.userPerDay }))).toBe("chat_daily_limit");
  });

  it("locks for the day after too many off-topic messages, ahead of the count", () => {
    expect(reason(chat(oldUser, { subjectOffTopicToday: q.offTopicPerDay - 1 }))).toBe("ok");
    expect(reason(chat(oldUser, { subjectOffTopicToday: q.offTopicPerDay, subjectChatsToday: q.userPerDay }))).toBe(
      "chat_off_topic_lock",
    );
  });

  it("caps an IP and the whole site", () => {
    expect(reason(chat(oldUser, { ipChatsToday: q.perIpPerDay }))).toBe("ip_chat_daily_limit");
    expect(reason(chat(oldUser, { siteChatsToday: q.sitePerDay }))).toBe("site_chat_daily_limit");
  });

  it("lets admins through", () => {
    expect(reason(chat({ kind: "admin" }, { subjectChatsToday: 999, subjectOffTopicToday: 99 }))).toBe("ok");
  });
});

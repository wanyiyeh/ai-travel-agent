import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, j } from "@/lib/db";
import { setTestCookie, signInAs } from "@tests/setup/mockAuth";
import { GUEST_COOKIE, signGuestId } from "@/lib/auth/guest";
import { QUOTAS } from "@/lib/quota";
import { OFF_TOPIC_REPLY } from "@/lib/chat/assistant";
import * as chatRoute from "@/app/api/v1/itinerary/[id]/chat/route";

// Story: an owner asks the chat assistant about their trip (MOCK_AI, so the
// replies are mockAi.ts's). The conversation and its proposals are kept,
// each message counts against the chat quota, off-topic messages lock the
// chat for the day, and a failed reply stores and charges nothing.

const stamp = Date.now();
const owner = { id: `chat-owner-${stamp}`, email: `chat-owner-${stamp}@example.com` };
const stranger = { id: `chat-stranger-${stamp}`, email: `chat-stranger-${stamp}@example.com` };
const itineraryId = `chat-trip-${stamp}`;

const ctx = { params: Promise.resolve({ id: itineraryId }) };
const send = (body: unknown) =>
  chatRoute.POST(new Request("http://test", { method: "POST", body: JSON.stringify(body) }), ctx);
const load = () => chatRoute.GET(new Request("http://test"), ctx);

async function resetChat() {
  await prisma.chatMessage.deleteMany({ where: { itineraryId } });
  await prisma.usageEvent.deleteMany({ where: { userId: owner.id } });
}

beforeAll(async () => {
  // An old account, so the regular daily limit applies.
  await prisma.user.createMany({ data: [{ ...owner, createdAt: new Date(stamp - 30 * 86_400_000) }, stranger] });
  await prisma.itinerary.create({
    data: {
      id: itineraryId,
      userId: owner.id,
      title: "東京",
      config: j({ flightInfo: { departureDate: "2026-12-01" } }),
      days: j([{ id: "d1", day: 1, waypointCity: "東京", stops: [{ id: "s1", name: "自己的景點", duration_minutes: 60 }] }]),
    },
  });
});

afterAll(async () => {
  await prisma.usageEvent.deleteMany({ where: { userId: { in: [owner.id, stranger.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
});

beforeEach(async () => {
  await resetChat();
  signInAs(owner);
});

describe("chat route", () => {
  it("answers, keeps the conversation and its proposals, and counts the message", async () => {
    const res = await send({ message: "刪掉第一站" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect(body.messages[1]).toMatchObject({
      category: "edit",
      proposals: [{ action: "remove_stop", params: { dayId: "d1", stopId: "s1" }, status: "pending" }],
    });
    expect(body.allowance).toMatchObject({ remaining: QUOTAS.chat.userPerDay - 1, blocked: null });

    const reloaded = await (await load()).json();
    expect(reloaded.messages).toEqual(body.messages);
    expect(await prisma.usageEvent.count({ where: { userId: owner.id, kind: "chat" } })).toBe(1);
  });

  it("keeps transport and detail cards across a reload", async () => {
    await send({ message: "幾點開" });
    const { messages } = await (await load()).json();
    expect(messages[1].cards).toEqual({ transport: [], places: [{ dayId: "d1", stopId: "s1" }] });
  });

  it("warns about, then locks after, too many off-topic messages", async () => {
    const replies: string[] = [];
    for (let i = 0; i < QUOTAS.chat.offTopicPerDay; i++) {
      const body = await (await send({ message: "幫我寫程式" })).json();
      replies.push(body.messages[1].content);
    }
    expect(replies[0]).toContain(OFF_TOPIC_REPLY);
    expect(replies[0]).toContain(`還可以再離題 ${QUOTAS.chat.offTopicPerDay - 1} 次`);
    expect(replies.at(-1)).toContain("今天的聊天已暫停");

    const locked = await send({ message: "第一天做什麼" });
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ code: "quota_exceeded", reason: "chat_off_topic_lock" });
    expect((await (await load()).json()).allowance.blocked).toMatchObject({ reason: "chat_off_topic_lock" });
  });

  it("stops at the daily limit", async () => {
    await prisma.usageEvent.createMany({
      data: Array.from({ length: QUOTAS.chat.userPerDay }, () => ({ kind: "chat", userId: owner.id, ipHash: "elsewhere" })),
    });
    const res = await send({ message: "第一天做什麼" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ reason: "chat_daily_limit" });
  });

  it("stores and charges nothing when the reply fails", async () => {
    vi.stubEnv("MOCK_AI", "error");
    try {
      expect((await send({ message: "第一天做什麼" })).status).toBe(502);
    } finally {
      vi.stubEnv("MOCK_AI", "1");
    }
    expect(await prisma.chatMessage.count({ where: { itineraryId } })).toBe(0);
    expect(await prisma.usageEvent.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("rejects empty and overlong messages", async () => {
    expect((await send({ message: "   " })).status).toBe(400);
    expect((await send({ message: "字".repeat(501) })).status).toBe(400);
  });

  it("is the owner's only", async () => {
    signInAs(stranger);
    expect((await send({ message: "第一天做什麼" })).status).toBe(404);
    expect((await load()).status).toBe(404);
    signInAs(null);
    expect((await load()).status).toBe(401);
  });
});

describe("chat route for guests", () => {
  const guestTripId = `chat-guest-trip-${stamp}`;
  const guestCtx = { params: Promise.resolve({ id: guestTripId }) };

  it("asks a guest to sign in, even on their own trip", async () => {
    const guest = await prisma.user.create({ data: { isGuest: true } });
    await prisma.itinerary.create({
      data: { id: guestTripId, userId: guest.id, title: "t", config: j({}), days: j([]), expiresAt: new Date(stamp + 86_400_000) },
    });
    signInAs(null);
    setTestCookie(GUEST_COOKIE, signGuestId(guest.id));
    try {
      const post = await chatRoute.POST(new Request("http://test", { method: "POST", body: JSON.stringify({ message: "嗨" }) }), guestCtx);
      expect(post.status).toBe(403);
      expect((await chatRoute.GET(new Request("http://test"), guestCtx)).status).toBe(403);
      expect(await prisma.chatMessage.count({ where: { itineraryId: guestTripId } })).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: guest.id } });
    }
  });
});

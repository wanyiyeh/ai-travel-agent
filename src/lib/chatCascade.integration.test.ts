import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, j } from "@/lib/db";
import { deleteAccount } from "@/lib/auth/deleteAccount";
import { cleanupExpiredGuests } from "@/lib/housekeeping";

// The chat's messages and proposals hang off the itinerary (PLAN-004), so
// every way an itinerary goes away must take its conversation with it:
// deleting the itinerary, deleting the account, and guest expiry.
const plain = new PrismaClient();
const run = Date.now();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: `chat-cascade-${run}` } } });
  await plain.$disconnect();
});

async function itineraryWithChat(userId: string, expiresAt?: Date) {
  const itinerary = await prisma.itinerary.create({
    data: { userId, title: "t", days: j([]), config: j({}), expiresAt },
  });
  const message = await prisma.chatMessage.create({
    data: {
      itineraryId: itinerary.id,
      role: "assistant",
      category: "edit",
      content: "第二天第三站可以刪掉。",
      proposals: { create: [{ action: "remove_stop", params: j({ dayId: "d2", stopId: "s3" }) }] },
    },
  });
  return { itineraryId: itinerary.id, messageId: message.id };
}

async function expectChatGone(itineraryId: string, messageId: string) {
  expect(await prisma.chatMessage.count({ where: { itineraryId } })).toBe(0);
  expect(await prisma.chatProposal.count({ where: { messageId } })).toBe(0);
}

describe("chat conversation cascades", () => {
  it("goes with a deleted itinerary", async () => {
    const user = await prisma.user.create({ data: { email: `chat-cascade-${run}-a@test.local` } });
    const { itineraryId, messageId } = await itineraryWithChat(user.id);
    expect(await prisma.chatProposal.count({ where: { messageId } })).toBe(1);

    await prisma.itinerary.delete({ where: { id: itineraryId } });

    await expectChatGone(itineraryId, messageId);
  });

  it("goes with a deleted account", async () => {
    const user = await prisma.user.create({ data: { email: `chat-cascade-${run}-b@test.local` } });
    const { itineraryId, messageId } = await itineraryWithChat(user.id);

    await deleteAccount(user.id);

    await expectChatGone(itineraryId, messageId);
  });

  it("goes with an expired guest itinerary", async () => {
    const guest = await prisma.user.create({ data: { isGuest: true } });
    const { itineraryId, messageId } = await itineraryWithChat(guest.id, new Date(run - 60_000));

    await cleanupExpiredGuests(plain, new Date(run));

    await expectChatGone(itineraryId, messageId);
    await prisma.user.deleteMany({ where: { id: guest.id } });
  });
});

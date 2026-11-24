import { z } from "zod";
import { prisma, j } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import type { OwnedItinerary } from "@/lib/auth/ownership";
import { MAX_NAME_LENGTH } from "@/lib/inputLimits";
import { chatAllowance, quotaExceededResponse, recordUsage, type ChatAllowance } from "@/lib/quota";
import { requestFingerprint } from "@/lib/requestFingerprint";
import { internalErrorResponse } from "@/lib/apiError";
import { MEAL_TYPES } from "@/types/itinerary";
import {
  answerChatMessage,
  CHAT_HISTORY_MESSAGES,
  CHAT_MESSAGE_MAX_LENGTH,
  type ChatAnswer,
  type StopRef,
} from "@/lib/chat/assistant";

// Reading and sending chat messages for an itinerary the caller owns
// (PLAN-004). The route checks ownership; this keeps the conversation and
// the quota. Proposals are stored here and applied elsewhere (#371, #372).

// A whole trip's stops, meals and lodging, with room to spare.
export const CHAT_MAX_SHOWN_NAMES = 400;

const Id = z.string().min(1).max(MAX_NAME_LENGTH);

export const SendChatSchema = z.object({
  message: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
  shownNames: z
    .array(
      z.object({
        ref: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("stop"), stopId: Id }),
          z.object({ kind: z.literal("meal"), dayId: Id, mealType: z.enum(MEAL_TYPES) }),
          z.object({ kind: z.literal("accommodation"), dayId: Id }),
        ]),
        name: z.string().max(MAX_NAME_LENGTH),
      }),
    )
    .max(CHAT_MAX_SHOWN_NAMES)
    .default([]),
});
export type SendChatInput = z.infer<typeof SendChatSchema>;

export interface ChatProposalView {
  id: string;
  action: string;
  params: unknown;
  status: string;
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  category: string | null;
  content: string;
  cards: { transport: StopRef[]; places: StopRef[] };
  proposals: ChatProposalView[];
  createdAt: string;
}

const NO_CARDS = { transport: [], places: [] };

type StoredMessage = {
  id: string;
  role: string;
  category: string | null;
  content: string;
  cards: string | null;
  createdAt: Date;
  proposals: { id: string; action: string; params: string; status: string; createdAt: Date }[];
};

function view(message: StoredMessage): ChatMessageView {
  return {
    id: message.id,
    role: message.role === "assistant" ? "assistant" : "user",
    category: message.category,
    content: message.content,
    cards: message.cards ? (JSON.parse(message.cards) as ChatMessageView["cards"]) : NO_CARDS,
    proposals: [...message.proposals]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((p) => ({ id: p.id, action: p.action, params: JSON.parse(p.params), status: p.status })),
    createdAt: message.createdAt.toISOString(),
  };
}

/** The whole conversation, oldest first. */
export async function loadConversation(itineraryId: string): Promise<ChatMessageView[]> {
  const messages = await prisma.chatMessage.findMany({
    where: { itineraryId },
    orderBy: { createdAt: "asc" },
    include: { proposals: true },
  });
  return messages.map(view);
}

async function recentHistory(itineraryId: string) {
  const recent = await prisma.chatMessage.findMany({
    where: { itineraryId },
    orderBy: { createdAt: "desc" },
    take: CHAT_HISTORY_MESSAGES,
    select: { role: true, content: true },
  });
  return recent.reverse().map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content }));
}

function departureDateOf(config: unknown): string {
  const flightInfo = (config as { flightInfo?: { departureDate?: unknown } } | null)?.flightInfo;
  return typeof flightInfo?.departureDate === "string" ? flightInfo.departureDate : "";
}

// The off-topic lock is announced before it closes, so it never comes as a surprise.
function offTopicNote(answer: ChatAnswer, before: ChatAllowance): string {
  if (answer.category !== "off_topic" || before.offTopicLeft === null) return "";
  const left = before.offTopicLeft - 1;
  return left > 0 ? `\n（今天還可以再離題 ${left} 次，之後聊天會暫停到明天。）` : "\n（今天的聊天已暫停，明天再來吧。）";
}

export async function chatAllowanceFor(actor: Actor, request: Request): Promise<ChatAllowance> {
  return chatAllowance(actor, requestFingerprint(request));
}

/**
 * Answers one message and stores it with the reply. A failed model call
 * stores nothing and charges nothing, so the owner can send it again.
 */
export async function sendChatMessage(
  request: Request,
  actor: Actor,
  itinerary: OwnedItinerary,
  input: SendChatInput,
): Promise<Response> {
  const fingerprint = requestFingerprint(request);
  const before = await chatAllowance(actor, fingerprint);
  if (before.blocked) return quotaExceededResponse(before.blocked);

  let answer: ChatAnswer;
  try {
    answer = await answerChatMessage({
      message: input.message,
      days: itinerary.days,
      departureDate: departureDateOf(itinerary.config),
      history: await recentHistory(itinerary.id),
      shownNames: input.shownNames,
      signal: request.signal,
    });
  } catch (error) {
    return internalErrorResponse("Chat", error, "助理暫時無法回覆，請稍後再試。", 502);
  }

  const now = Date.now();
  const cards = answer.transportCards.length || answer.placeCards.length ? j({ transport: answer.transportCards, places: answer.placeCards }) : null;
  const [userMessage, assistantMessage] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: { itineraryId: itinerary.id, role: "user", content: input.message, createdAt: new Date(now) },
      include: { proposals: true },
    }),
    prisma.chatMessage.create({
      data: {
        itineraryId: itinerary.id,
        role: "assistant",
        category: answer.category,
        content: answer.reply + offTopicNote(answer, before),
        cards,
        // A millisecond later, so the reply always sorts after the question.
        createdAt: new Date(now + 1),
        proposals: {
          create: answer.proposals.map((p, i) => ({ action: p.action, params: j(p.params), createdAt: new Date(now + 1 + i) })),
        },
      },
      include: { proposals: true },
    }),
  ]);

  if (!actor.isAdmin) {
    const owner = { userId: actor.userId, isGuest: actor.kind === "guest" };
    await recordUsage("chat", owner, fingerprint, itinerary.id);
    if (answer.category === "off_topic") await recordUsage("chat_off_topic", owner, fingerprint, itinerary.id);
  }

  return Response.json({
    messages: [view(userMessage), view(assistantMessage)],
    allowance: await chatAllowance(actor, fingerprint),
  });
}

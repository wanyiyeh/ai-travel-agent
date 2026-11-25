import type { z } from "zod";
import { generateObject, LlmOutputError, type LlmEffort } from "@/lib/llm";
import { UNTRUSTED_INPUT_RULE, wrapUntrusted } from "@/lib/untrustedInput";
import { mockChatClassification, mockChatReply } from "@/lib/mockAi";
import { replaceShownNames, tripCities, tripSummary, type ShownName } from "@/lib/chat/context";
import { proposalProblem } from "@/lib/chat/proposalRules";
import {
  ChatClassificationSchema,
  EditReplySchema,
  ItineraryQuestionReplySchema,
  PlaceFactReplySchema,
  RestructureReplySchema,
  type ChatCategory,
  type EditAction,
} from "@/lib/chat/schemas";
import type { MealType } from "@/types/itinerary";

// The chat assistant's two steps (ADR-0013): classify the message, then ask
// for a reply in the one shape its class allows. Off-topic messages and
// travel-knowledge questions (v2, #364) get a fixed reply without a second
// call. Nothing here touches the database or applies a change.

/** How many earlier messages go into the model's input. */
export const CHAT_HISTORY_MESSAGES = 6;
/** Longest message the owner can send; the route rejects longer ones. */
export const CHAT_MESSAGE_MAX_LENGTH = 500;
// Each earlier message is cut to this length in the model's input.
const HISTORY_MESSAGE_MAX_LENGTH = 300;
const CLASSIFY_MAX_TOKENS = 1000;
const REPLY_MAX_TOKENS = 4000;
// Restructure turns a sentence into a whole route, so it gets more thought.
const REPLY_EFFORT: Partial<Record<ChatCategory, LlmEffort>> = { restructure: "medium" };

export const SUGGESTED_QUESTIONS = ["哪一天最趕？", "第一天要做什麼？", "幫我調整城市天數"];
export const OFF_TOPIC_REPLY = "我只能回答這趟行程的問題，例如安排、時間、交通，或幫你調整行程。";
export const TRAVEL_KNOWLEDGE_REPLY = "旅遊知識的問題之後會支援。現在可以先問我這趟行程的安排，或請我調整行程。";
export const CHAT_FAILURE_REPLY = "我沒辦法處理這個要求，可以換個說法再試一次。";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatInput {
  message: string;
  days: unknown;
  /** Day 1's date (YYYY-MM-DD), or "" when the trip has none. */
  departureDate: string;
  /** Earlier messages, oldest first. */
  history: ChatTurn[];
  /** The place names on the owner's screen, with what they point at. */
  shownNames: ShownName[];
  signal?: AbortSignal;
}

/** A proposed change, in our own references only (ADR-0004), ready to store as a ChatProposal. */
export type ChatProposalDraft =
  | { action: "remove_stop" | "replace_stop"; params: { dayId: string; stopId: string } }
  | { action: "move_stop"; params: { dayId: string; stopId: string; toIndex: number } }
  | { action: "suggest_stops"; params: { dayId: string; request: string | null } }
  | { action: "replace_meal"; params: { dayId: string; mealType: MealType; request: string | null } }
  | { action: "remove_meal" | "restore_meal"; params: { dayId: string; mealType: MealType } }
  | { action: "replace_accommodation"; params: { dayId: string } }
  | { action: "restructure"; params: { cities: { name: string; days: number; isNew: boolean }[] } };

export interface StopRef {
  dayId: string;
  stopId: string;
}

export interface ChatAnswer {
  category: ChatCategory;
  reply: string;
  proposals: ChatProposalDraft[];
  /** Stops whose stored transport line to show (ADR-0013). */
  transportCards: StopRef[];
  /** Stops whose 「照片與詳情」 to offer. */
  placeCards: StopRef[];
}

const CLASSIFY_SYSTEM = `你是旅遊行程助理的分類器。判斷旅客的新訊息屬於哪一類，只輸出 JSON。

類別：
- itinerary_question：問這趟行程的安排，例如某天做什麼、幾點、哪天最趕、城市之間或兩站之間怎麼移動
- edit：要修改某一天的內容，例如刪除、換掉、調整順序、加景點、換餐廳、換住宿、刪除或加回餐點
- restructure：要改城市、城市順序或在每個城市待幾天
- place_fact：問某個地點本身的事實，例如營業時間、地址、評價、門票
- travel_knowledge：問這趟行程目的地的一般旅遊知識，例如小費、習俗、天氣、簽證
- off_topic：跟這趟行程無關，包括其他目的地的旅遊問題，以及寫程式、聊天等

規則：
- 只有跟使用者訊息裡列出的這趟行程城市、所在國家或日期有關的問題，才不算 off_topic
- 不確定屬於哪一類時，confident 填 false
${UNTRUSTED_INPUT_RULE}`;

const REPLY_BASE = `你是旅遊行程助理，只談使用者訊息裡的這一趟行程，用繁體中文、簡短回答（150 字以內）。

行程的格式：第N天列出日期、城市，以及每一站的時段、停留時間。地點沒有名稱，只用「第N天第K站」稱呼，回覆也這樣稱呼，畫面會補上名稱。旅客訊息裡的「第N天第K站」是系統替旅客換上的位置。
不要自己編造地點名稱、營業時間、價格或交通時間。`;

const REPLY_SYSTEM: Record<"itinerary_question" | "edit" | "restructure" | "place_fact", string> = {
  itinerary_question: `${REPLY_BASE}
回答旅客對行程安排的問題，只根據行程資料。
旅客問兩站之間的交通時，你看不到交通時間：在 transportCards 列出後一站（第N天第K站，K 至少為 2），回覆說「交通方式如下」，畫面會顯示。`,
  edit: `${REPLY_BASE}
把旅客的要求轉成 actions，每個修改一個 action；旅客確認後才會套用，回覆要說明「確認後才會修改」。
- 移動日的城市間交通、旅客預訂的固定行程、整天鎖定的天不能修改，遇到時說明原因，不產生 action
- move_stop 只能在同一天內調整順序，toPosition 是移動後的站序
- replace_meal 與 suggest_stops 的 request 放旅客描述的條件（例如「拉麵」「室內」），沒有就填 null
- 不確定旅客指哪一站（例如同名的地點在好幾天）時，actions 留空並反問`,
  restructure: `${REPLY_BASE}
旅客想改城市、順序或天數。在 cities 依順序列出修改後的完整路線：每個城市的名稱、待幾天、是否是新加入的城市；城市名稱沿用行程裡的寫法。
回覆說明哪些地方會改變，以及確認後被調整的天會重新產生、原本的內容會進垃圾桶。
要求不清楚時，cities 填 null 並反問。`,
  place_fact: `${REPLY_BASE}
旅客問的是地點本身的事實（營業時間、地址、評價等）。你沒有這些資料，不要猜：在 places 列出相關的站，回覆請旅客點「照片與詳情」查看。`,
};

function historyText(history: ChatTurn[]): string {
  return history
    .slice(-CHAT_HISTORY_MESSAGES)
    .map((turn) => `${turn.role === "user" ? "旅客" : "助理"}：${turn.content.slice(0, HISTORY_MESSAGE_MAX_LENGTH)}`)
    .join("\n");
}

function classifyUser(input: ChatInput): string {
  return [
    `這趟行程的城市：\n${wrapUntrusted(tripCities(input.days).join("、"))}`,
    ...(input.history.length ? [`最近的對話：\n${wrapUntrusted(historyText(input.history))}`] : []),
    `旅客的新訊息：\n${wrapUntrusted(input.message)}`,
  ].join("\n\n");
}

function replyUser(input: ChatInput, message: string): string {
  return [
    `行程：\n${wrapUntrusted(tripSummary(input.days, input.departureDate))}`,
    ...(input.history.length ? [`最近的對話：\n${wrapUntrusted(historyText(input.history))}`] : []),
    `旅客的新訊息：\n${wrapUntrusted(message)}`,
  ].join("\n\n");
}

/** The message's class; an unsure call is itinerary_question, which can't change anything. */
export async function classifyChatMessage(input: ChatInput): Promise<ChatCategory> {
  const { category, confident } = await generateObject({
    system: CLASSIFY_SYSTEM,
    user: classifyUser(input),
    schema: ChatClassificationSchema,
    maxTokens: CLASSIFY_MAX_TOKENS,
    signal: input.signal,
    mock: () => mockChatClassification(input.message),
  });
  return confident ? category : "itinerary_question";
}

type Rec = Record<string, unknown>;
const records = (value: unknown): Rec[] =>
  Array.isArray(value) ? value.filter((v): v is Rec => Boolean(v) && typeof v === "object") : [];

function dayAt(days: unknown, dayNumber: number): Rec | undefined {
  const day = records(days)[dayNumber - 1];
  return typeof day?.id === "string" ? day : undefined;
}

function stopAt(days: unknown, dayNumber: number, stopNumber: number): StopRef | undefined {
  const day = dayAt(days, dayNumber);
  const stop = day && records(day.stops)[stopNumber - 1];
  return day && typeof stop?.id === "string" ? { dayId: day.id as string, stopId: stop.id } : undefined;
}

// Position → IDs. A position the trip doesn't have is dropped, not guessed.
function resolveAction(days: unknown, a: EditAction): ChatProposalDraft | undefined {
  const day = dayAt(days, a.dayNumber);
  if (!day) return undefined;
  const dayId = day.id as string;
  switch (a.action) {
    case "remove_stop":
    case "replace_stop": {
      const stop = stopAt(days, a.dayNumber, a.stopNumber);
      return stop && { action: a.action, params: stop };
    }
    case "move_stop": {
      const stop = stopAt(days, a.dayNumber, a.stopNumber);
      const count = records(day.stops).length;
      if (!stop || a.toPosition > count) return undefined;
      return { action: "move_stop", params: { ...stop, toIndex: a.toPosition - 1 } };
    }
    case "suggest_stops":
      return { action: "suggest_stops", params: { dayId, request: a.request } };
    case "replace_meal":
      return { action: "replace_meal", params: { dayId, mealType: a.mealType, request: a.request } };
    case "remove_meal":
    case "restore_meal":
      return { action: a.action, params: { dayId, mealType: a.mealType } };
    case "replace_accommodation":
      return { action: "replace_accommodation", params: { dayId } };
  }
}

function resolveStops(days: unknown, refs: { dayNumber: number; stopNumber: number }[]): StopRef[] {
  return refs.flatMap((r) => stopAt(days, r.dayNumber, r.stopNumber) ?? []);
}

function droppedNote(dropped: number): string {
  return dropped > 0 ? `\n（有 ${dropped} 項對不上目前的行程或不能修改，沒有列出。）` : "";
}

async function reply<S extends z.ZodType>(
  input: ChatInput,
  category: keyof typeof REPLY_SYSTEM,
  schema: S,
  message: string,
): Promise<z.infer<S>> {
  return generateObject({
    system: REPLY_SYSTEM[category] + UNTRUSTED_INPUT_RULE,
    user: replyUser(input, message),
    schema,
    effort: REPLY_EFFORT[category],
    maxTokens: REPLY_MAX_TOKENS,
    signal: input.signal,
    mock: () => mockChatReply(category, input.days, tripCities(input.days)),
  });
}

const fixed = (category: ChatCategory, text: string): ChatAnswer => ({
  category,
  reply: text,
  proposals: [],
  transportCards: [],
  placeCards: [],
});

/**
 * Classifies the message and answers it in the shape its class allows.
 * A reply that doesn't fit the shape becomes CHAT_FAILURE_REPLY with no
 * proposals; a failed request throws, so the caller can let it be retried.
 */
export async function answerChatMessage(raw: ChatInput): Promise<ChatAnswer> {
  // Names the owner typed, now and earlier, become 「第N天第K站」 before
  // anything reaches the model, so no prompt carries a Google name.
  const named = (text: string) => replaceShownNames(text, raw.days, raw.shownNames);
  const input: ChatInput = {
    ...raw,
    message: named(raw.message),
    history: raw.history.map((turn) => (turn.role === "user" ? { ...turn, content: named(turn.content) } : turn)),
  };
  const { message } = input;

  const category = await classifyChatMessage(input);
  if (category === "off_topic") return fixed(category, OFF_TOPIC_REPLY);
  if (category === "travel_knowledge") return fixed(category, TRAVEL_KNOWLEDGE_REPLY);

  try {
    switch (category) {
      case "itinerary_question": {
        const r = await reply(input, category, ItineraryQuestionReplySchema, message);
        return { ...fixed(category, r.reply), transportCards: resolveStops(input.days, r.transportCards) };
      }
      case "place_fact": {
        const r = await reply(input, category, PlaceFactReplySchema, message);
        return { ...fixed(category, r.reply), placeCards: resolveStops(input.days, r.places) };
      }
      case "edit": {
        const r = await reply(input, category, EditReplySchema, message);
        const proposals = r.actions
          .flatMap((a) => resolveAction(input.days, a) ?? [])
          .filter((p) => !proposalProblem(input.days, p));
        return { ...fixed(category, r.reply + droppedNote(r.actions.length - proposals.length)), proposals };
      }
      case "restructure": {
        const r = await reply(input, category, RestructureReplySchema, message);
        const proposals: ChatProposalDraft[] = r.cities?.length ? [{ action: "restructure", params: { cities: r.cities } }] : [];
        return { ...fixed(category, r.reply), proposals };
      }
    }
  } catch (error) {
    if (error instanceof LlmOutputError && error.reason === "invalid_output") return fixed(category, CHAT_FAILURE_REPLY);
    throw error;
  }
}

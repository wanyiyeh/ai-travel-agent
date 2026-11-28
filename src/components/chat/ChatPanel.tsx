"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Day } from "@/types/itinerary";
import type { ChatMessageView, ChatProposalView } from "@/lib/chat/conversation";
import type { PickerRequest } from "@/lib/chat/proposals";
import type { CityPreview, RestructureRequest } from "@/lib/chat/restructureProposal";
import { CHAT_MESSAGE_MAX_LENGTH, SUGGESTED_QUESTIONS } from "@/lib/chat/constants";
import { describeProposal, hasZhuyin, isInputMethodKey, placeIdOf, shownNamesOf, stepSentHistory, stopLabel, transportCard, withStopNames } from "@/lib/chat/display";
import type { useItineraryChat } from "@/hooks/useItineraryChat";
import { PlaceDetailsButton } from "@/components/PlaceDetailsButton";
import GoogleMapsAttribution from "@/components/GoogleMapsAttribution";

// The itinerary chat assistant's panel (PLAN-004). It only shows and sends:
// changes are proposals the owner confirms here (ADR-0013); picks happen in
// the itinerary's own pickers, and restructures in the restructure route.

type Chat = ReturnType<typeof useItineraryChat>;

interface ChatPanelProps {
  itineraryId: string;
  chat: Chat;
  /** The trip as the page shows it, names included. */
  days: Day[];
  onClose: () => void;
  /** A confirmed change that needs a pick: open that picker on the page. */
  /** proposalId is null when the change is already applied and the pick is a follow-up. */
  onOpenPicker: (picker: PickerRequest, proposalId: string | null) => void;
  /** The trip changed here: reload it (then recalculate that day's transport); resolves once it shows. */
  onTripChanged: (recalculateDayId?: string | null) => Promise<void>;
}

const STATUS_LABELS: Record<string, string> = { applied: "已套用", cancelled: "已取消", stale: "已失效，請重新問一次" };

function RestructureConfirm({
  itineraryId,
  preview,
  request,
  onDone,
  onBack,
}: {
  itineraryId: string;
  preview: CityPreview[];
  request: RestructureRequest;
  onDone: () => Promise<void>;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removed = preview.flatMap((c) => c.removedDayNumbers);
  const fresh = preview.reduce((sum, c) => sum + c.newDays, 0);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/itinerary/${itineraryId}/restructure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "重新規劃失敗，請稍後再試");
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新規劃失敗，請稍後再試");
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-md bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-zinc-700 dark:text-zinc-200">
      <ul className="space-y-0.5">
        {preview.map((c) => (
          <li key={c.name}>
            {c.name}
            {c.isNew ? "（新）" : ""}：{c.isNew ? `${c.daysAfter} 天` : `${c.daysBefore} → ${c.daysAfter} 天`}
          </li>
        ))}
      </ul>
      <p>
        {fresh > 0 ? `會重新產生 ${fresh} 天` : "不會產生新的天"}
        {removed.length > 0 ? `；第 ${removed.join("、")} 天的內容會進垃圾桶` : ""}。這會查詢地點，跟「重新規劃行程」一樣計入額度。
      </p>
      {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={busy}
          className="px-3 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {busy ? "重新規劃中…" : "確定重新規劃"}
        </button>
        <button type="button" onClick={onBack} disabled={busy} className="px-3 py-1 rounded-md text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          先不要
        </button>
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  days,
  itineraryId,
  chat,
  onOpenPicker,
  onTripChanged,
}: {
  proposal: ChatProposalView;
  days: Day[];
  itineraryId: string;
  chat: Chat;
  onOpenPicker: ChatPanelProps["onOpenPicker"];
  onTripChanged: ChatPanelProps["onTripChanged"];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restructure, setRestructure] = useState<{ request: RestructureRequest; preview: CityPreview[] } | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    // Before the change: afterwards the card's place may be gone.
    chat.rememberLabel(proposal.id, describeProposal(proposal, days));
    const result = await chat.decide(proposal.id, "confirm");
    // Applied here: stay busy until the trip on the page shows the change.
    if (result.status === "applied") await onTripChanged(result.recalculateDayId);
    setBusy(false);
    if (result.error) return setError(result.error);
    // A restored meal comes back as an empty slot: its picker follows, with
    // nothing left to report to the card.
    if (result.picker) return onOpenPicker(result.picker, result.status === "applied" ? null : proposal.id);
    if (result.restructure) return setRestructure(result.restructure);
  };

  const cancel = async () => {
    setBusy(true);
    const result = await chat.decide(proposal.id, "cancel");
    setBusy(false);
    if (result.error) setError(result.error);
  };

  const pending = proposal.status === "pending";
  return (
    <div className="mt-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2.5">
      <p className="text-sm text-zinc-800 dark:text-zinc-100">
        {(!pending && chat.confirmedLabels[proposal.id]) || describeProposal(proposal, days)}
      </p>
      {!pending && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{STATUS_LABELS[proposal.status] ?? proposal.status}</p>}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {pending && restructure ? (
        <RestructureConfirm
          itineraryId={itineraryId}
          preview={restructure.preview}
          request={restructure.request}
          onBack={() => setRestructure(null)}
          onDone={async () => {
            await chat.decide(proposal.id, "picked");
            await onTripChanged();
            setRestructure(null);
          }}
        />
      ) : pending && chat.readOnly ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">等待確認（行程的主人按「確認」才會套用）</p>
      ) : (
        pending && (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="px-3 py-1 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:opacity-60"
            >
              {busy ? "套用中…" : "確認"}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="px-3 py-1 rounded-md text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              取消
            </button>
          </div>
        )
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  current,
  ...rest
}: { message: ChatMessageView; current: boolean } & Omit<Parameters<typeof ProposalCard>[0], "proposal">) {
  const { days } = rest;
  // 「第N天第K站」 means a position, and positions move once the trip changes:
  // names go only on the latest reply, until one of its changes is applied.
  const named = current && !message.proposals.some((p) => p.status === "applied");
  return (
    <div className="max-w-[92%]">
      <div className="rounded-lg rounded-tl-sm bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 whitespace-pre-wrap">
        {named ? withStopNames(message.content, days) : message.content}
      </div>
      {message.cards.transport.map((ref) => {
        const card = transportCard(days, ref);
        return card ? (
          <div key={`t-${ref.stopId}`} className="mt-2 rounded-md bg-sky-50 dark:bg-sky-950/30 px-2.5 py-2 text-xs text-zinc-700 dark:text-zinc-200">
            <p className="font-medium">{card.title}</p>
            <p>{card.text}</p>
          </div>
        ) : null;
      })}
      {message.cards.places.map((ref) => (
        <div key={`p-${ref.stopId}`} className="mt-2 flex items-center justify-between gap-2 rounded-md bg-sky-50 dark:bg-sky-950/30 px-2.5 py-2 text-xs text-zinc-700 dark:text-zinc-200">
          <span>{stopLabel(days, ref)}</span>
          <PlaceDetailsButton placeId={placeIdOf(days, ref)} />
        </div>
      ))}
      {message.proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} {...rest} />
      ))}
    </div>
  );
}

export default function ChatPanel({ itineraryId, chat, days, onClose, onOpenPicker, onTripChanged }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  // Which sent message ↑/↓ put in the box; null once the owner types.
  const [recallAt, setRecallAt] = useState<number | null>(null);
  const composing = useRef(false);
  const [zhuyinHint, setZhuyinHint] = useState(false);
  const compositionEndedAt = useRef(-Infinity);
  const listRef = useRef<HTMLDivElement>(null);
  const { messages, allowance, loaded, sending, error, signInRequired, readOnly } = chat;

  useEffect(() => {
    if (!chat.loaded) void chat.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending]);

  const blocked = allowance?.blocked?.message ?? null;
  const unpicked = hasZhuyin(draft);
  const canSend = !sending && !blocked && !signInRequired && draft.trim().length > 0 && !unpicked;

  const submit = async (text = draft) => {
    const message = text.trim();
    if (!message || sending || blocked) return;
    setDraft("");
    setRecallAt(null);
    const sent = await chat.send(message, shownNamesOf(days));
    // Nothing was sent or charged: put the text back for a retry.
    if (!sent) setDraft(message);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Keys while picking characters in an input method belong to it, not the box.
    const ime = { composing: composing.current, msSinceCompositionEnd: e.timeStamp - compositionEndedAt.current };
    if (isInputMethodKey(e.nativeEvent, ime)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (unpicked) setZhuyinHint(true);
      else if (canSend) void submit();
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    // ↑ recalls only into an empty box or over a recalled message, never over
    // a draft being typed; and only from the first line (↓: the last), so the
    // arrows still move between lines of a longer message.
    const box = e.currentTarget;
    const up = e.key === "ArrowUp";
    if (up && draft !== "" && recallAt === null) return;
    const onEdgeLine = up
      ? !box.value.slice(0, box.selectionStart).includes("\n")
      : !box.value.slice(box.selectionEnd).includes("\n");
    if (!onEdgeLine) return;
    const sent = messages.filter((m) => m.role === "user").map((m) => m.content);
    const step = stepSentHistory(sent, recallAt, up ? "up" : "down");
    if (!step) return;
    e.preventDefault();
    setRecallAt(step.at);
    setDraft(step.text);
  };

  const cardProps = { days, itineraryId, chat, onOpenPicker, onTripChanged };
  const lastAssistantId = messages.findLast((m) => m.role === "assistant")?.id;
  const showSuggestions = !sending && !blocked && !signInRequired && (messages.length === 0 || messages.at(-1)?.role === "assistant");

  return (
    <div className="flex h-full flex-col bg-white dark:bg-zinc-900" data-print-hidden>
      <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">行程助理</p>
          {readOnly && <p className="text-xs text-zinc-500 dark:text-zinc-400">示範對話（唯讀）</p>}
          {allowance?.remaining != null && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">今天還可以問 {allowance.remaining} 則</p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="關閉行程助理" className="p-1 rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {signInRequired ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">登入後就可以問行程助理問題，或請它幫你調整行程。</p>
        ) : !loaded ? (
          <p className="text-sm text-zinc-500">載入中…</p>
        ) : messages.length === 0 && readOnly ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">這份範例沒有示範對話。</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            可以問這趟行程的安排，或請我幫你調整，例如「第二天少排一個景點」「第三天晚餐想吃拉麵」。修改都要你確認後才會套用。
          </p>
        ) : null}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-blue-600 px-3 py-2 text-sm text-white whitespace-pre-wrap">{m.content}</div>
            </div>
          ) : (
            <AssistantMessage key={m.id} message={m} current={m.id === lastAssistantId} {...cardProps} />
          ),
        )}
        {sending && <p className="text-sm text-zinc-500">助理正在想…</p>}
        {/* Place names on cards and replies are Google's, shown without a map. */}
        {messages.length > 0 && <GoogleMapsAttribution className="px-0" />}
      </div>

      {readOnly ? (
        <p className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-3 text-xs text-zinc-600 dark:text-zinc-300">
          這是行程主人和助理的對話。登入後，在自己的行程上就能使用行程助理。
        </p>
      ) : (
        <div className="border-t border-zinc-200 dark:border-zinc-700 px-4 py-3 space-y-2">
          {showSuggestions && (
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void submit(q)}
                  className="px-2.5 py-1 rounded-full border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          {(blocked || error) && <p className="text-xs text-red-600 dark:text-red-400">{blocked ?? error}</p>}
          {zhuyinHint && unpicked && (
            <p className="text-xs text-amber-700 dark:text-amber-400">還有沒選完的注音，選好字再送出。</p>
          )}
          {!signInRequired && (
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setRecallAt(null);
                  setZhuyinHint(false);
                }}
                onKeyDown={onKeyDown}
                onCompositionStart={() => (composing.current = true)}
                onCompositionEnd={(e) => {
                  composing.current = false;
                  compositionEndedAt.current = e.timeStamp;
                }}
                maxLength={CHAT_MESSAGE_MAX_LENGTH}
                rows={2}
                disabled={Boolean(blocked)}
                placeholder="問這趟行程，或請我調整…"
                aria-label="給行程助理的訊息"
                className="flex-1 resize-none rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSend}
                className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                送出
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

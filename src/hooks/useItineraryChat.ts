"use client";

import { useCallback, useState } from "react";
import type { ChatMessageView } from "@/lib/chat/conversation";
import type { ChatAllowance } from "@/lib/quota";
import type { ShownName } from "@/lib/chat/context";
import type { PickerRequest } from "@/lib/chat/proposals";
import type { CityPreview, RestructureRequest } from "@/lib/chat/restructureProposal";

// The chat panel's calls (PLAN-004): load the conversation, send a message,
// and confirm, cancel or report the pick for a proposal card.

export type ProposalStatus = "pending" | "applied" | "cancelled" | "stale";

export interface DecisionResult {
  status?: ProposalStatus;
  /** A change that needs a pick: which picker to open. */
  picker?: PickerRequest;
  /** A restructure: what to send to the restructure route, and what it will do. */
  restructure?: { request: RestructureRequest; preview: CityPreview[] };
  /** A day whose transport lines to recalculate, as after a drag. */
  recalculateDayId?: string | null;
  error?: string;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function useItineraryChat(itineraryId: string) {
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [allowance, setAllowance] = useState<ChatAllowance | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  // A public example's conversation, shown to someone other than its owner.
  const [readOnly, setReadOnly] = useState(false);
  // What each card said, names included, when it was confirmed: once the
  // change is applied its place may be gone from the trip. Kept for this
  // visit only; Google's names aren't stored (ADR-0004).
  const [confirmedLabels, setConfirmedLabels] = useState<Record<string, string>>({});
  const rememberLabel = useCallback((proposalId: string, label: string) => {
    setConfirmedLabels((prev) => ({ ...prev, [proposalId]: label }));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/v1/itinerary/${itineraryId}/chat`);
      if (res.status === 403) {
        setSignInRequired(true);
        return;
      }
      if (!res.ok) throw new Error(await errorOf(res, "無法載入對話"));
      const body = (await res.json()) as { messages: ChatMessageView[]; allowance: ChatAllowance | null; readOnly?: boolean };
      setMessages(body.messages);
      setAllowance(body.allowance);
      setReadOnly(Boolean(body.readOnly));
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入對話");
    } finally {
      setLoaded(true);
    }
  }, [itineraryId]);

  /** Resolves true when the message went through; on failure the caller keeps the text for a retry. */
  const send = useCallback(
    async (message: string, shownNames: ShownName[]): Promise<boolean> => {
      setSending(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/itinerary/${itineraryId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, shownNames }),
        });
        if (res.status === 429) {
          // Over the quota: nothing was charged; show the reason and refresh the counts.
          setError(await errorOf(res, "今天的聊天次數已用完"));
          void load();
          return false;
        }
        if (!res.ok) throw new Error(await errorOf(res, "助理暫時無法回覆，請稍後再試。"));
        const body = (await res.json()) as { messages: ChatMessageView[]; allowance: ChatAllowance };
        setMessages((prev) => [...prev, ...body.messages]);
        setAllowance(body.allowance);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "助理暫時無法回覆，請稍後再試。");
        return false;
      } finally {
        setSending(false);
      }
    },
    [itineraryId, load],
  );

  const setProposalStatus = useCallback((proposalId: string, status: ProposalStatus) => {
    setMessages((prev) =>
      prev.map((m) => ({ ...m, proposals: m.proposals.map((p) => (p.id === proposalId ? { ...p, status } : p)) })),
    );
  }, []);

  const decide = useCallback(
    async (proposalId: string, decision: "confirm" | "cancel" | "picked"): Promise<DecisionResult> => {
      try {
        const res = await fetch(`/api/v1/itinerary/${itineraryId}/chat/proposals/${proposalId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        const body = (await res.json().catch(() => ({}))) as DecisionResult & { code?: string };
        if (body.status && body.status !== "pending") setProposalStatus(proposalId, body.status);
        // Already handled elsewhere (another tab, a double click): reload to show where it stands.
        if (body.code === "proposal_resolved") void load();
        return res.ok ? body : { ...body, error: body.error ?? "沒辦法處理這個提案" };
      } catch {
        return { error: "沒辦法處理這個提案，請稍後再試" };
      }
    },
    [itineraryId, load, setProposalStatus],
  );

  return {
    messages,
    allowance,
    loaded,
    sending,
    error,
    signInRequired,
    readOnly,
    confirmedLabels,
    rememberLabel,
    load,
    send,
    decide,
    setError,
  };
}

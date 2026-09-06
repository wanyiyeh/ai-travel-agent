import { useState } from "react";

export interface HistoryBatch<T> {
  id: string;
  createdAt: string;
  candidates: T[];
}

/**
 * Shared paging/expand-state for a candidate picker's "查看歷史候選" section.
 * `historyUrl` must already include every query param except `cursor` (e.g.
 * `itineraryId=...`); this hook appends `&cursor=` itself when loading more.
 *
 * The most recent batch is whatever the picker's own regenerate call just
 * fetched, so the first page is skipped here to avoid showing it twice.
 */
export function useCandidateHistory<T>(historyUrl: string) {
  const [showHistory, setShowHistory] = useState(false);
  const [batches, setBatches] = useState<HistoryBatch<T>[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleBatch = (batchId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  const toggleHistory = async () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    if (batches !== null) return; // already loaded once

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(historyUrl);
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "取得歷史候選失敗");
      setBatches(((resData.history ?? []) as HistoryBatch<T>[]).slice(1));
      setNextCursor((resData.nextCursor as string | null) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得歷史候選失敗");
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await fetch(`${historyUrl}&cursor=${encodeURIComponent(nextCursor)}`);
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "取得歷史候選失敗");
      setBatches((prev) => [...(prev ?? []), ...((resData.history ?? []) as HistoryBatch<T>[])]);
      setNextCursor((resData.nextCursor as string | null) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "取得歷史候選失敗");
    } finally {
      setLoadingMore(false);
    }
  };

  return {
    showHistory,
    batches,
    loading,
    loadingMore,
    error,
    nextCursor,
    expandedIds,
    toggleBatch,
    toggleHistory,
    loadMore,
  };
}

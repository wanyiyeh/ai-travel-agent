"use client";

import { useEffect, useState } from "react";
import type { Meal, MealCandidate, MealType } from "@/types/itinerary";

interface MealPickerProps {
  itineraryId: string;
  dayId: string;
  mealType: MealType;
  mealLabel: string;
  currency?: string;
  onCancel: () => void;
  onSelected: (meal: Meal) => void;
}

type HistoryBatch = {
  id: string;
  createdAt: string;
  candidates: MealCandidate[];
};

const VISIBLE_CANDIDATES = 5;

const candidateKey = (c: MealCandidate) => c.placeId ?? c.name;

const formatBatchTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function MealPicker({
  itineraryId,
  dayId,
  mealType,
  mealLabel,
  currency,
  onCancel,
  onSelected,
}: MealPickerProps) {
  const [candidates, setCandidates] = useState<MealCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectingKey, setSelectingKey] = useState<string | null>(null);
  const [showAllCandidates, setShowAllCandidates] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [historyBatches, setHistoryBatches] = useState<HistoryBatch[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(new Set());

  const toggleBatch = (batchId: string) => {
    setExpandedBatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/days/${dayId}/meals/${mealType}/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itineraryId }),
        });
        const resData = await res.json();
        if (!res.ok) throw new Error(resData.error || "取得候選餐廳失敗");
        if (!cancelled) setCandidates((resData.candidates ?? []) as MealCandidate[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "取得候選餐廳失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dayId, mealType, itineraryId]);

  const toggleHistory = async () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setShowHistory(true);
    if (historyBatches !== null) return; // already loaded once

    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(
        `/api/v1/days/${dayId}/meals/${mealType}/candidates-history?itineraryId=${encodeURIComponent(itineraryId)}`
      );
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "取得歷史候選失敗");
      // The newest batch is whatever /regenerate just fetched above — skip it
      // here so the same candidates aren't shown twice.
      setHistoryBatches(((resData.history ?? []) as HistoryBatch[]).slice(1));
      setHistoryNextCursor((resData.nextCursor as string | null) ?? null);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "取得歷史候選失敗");
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadMoreHistory = async () => {
    if (!historyNextCursor) return;
    setHistoryLoadingMore(true);
    setHistoryError(null);
    try {
      const res = await fetch(
        `/api/v1/days/${dayId}/meals/${mealType}/candidates-history?itineraryId=${encodeURIComponent(itineraryId)}&cursor=${encodeURIComponent(historyNextCursor)}`
      );
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "取得歷史候選失敗");
      setHistoryBatches((prev) => [...(prev ?? []), ...((resData.history ?? []) as HistoryBatch[])]);
      setHistoryNextCursor((resData.nextCursor as string | null) ?? null);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "取得歷史候選失敗");
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  const handlePick = async (candidate: MealCandidate) => {
    if (candidate.isCurrent) {
      onCancel();
      return;
    }
    setError(null);
    setSelectingKey(candidateKey(candidate));
    try {
      const meal: Meal = {
        name: candidate.name,
        description: candidate.description,
        estimated_cost: candidate.estimated_cost,
        placeId: candidate.placeId,
        lat: candidate.lat,
        lng: candidate.lng,
        address: candidate.address,
        rating: candidate.rating,
      };
      const res = await fetch(`/api/v1/days/${dayId}/meals/${mealType}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itineraryId, meal }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "選擇餐廳失敗");
      onSelected(resData.meal as Meal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "選擇餐廳失敗");
      setSelectingKey(null);
    }
  };

  const renderCandidateCard = (candidate: MealCandidate, key: string) => {
    const selecting = selectingKey === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => handlePick(candidate)}
        disabled={selectingKey !== null}
        className={`w-full text-left rounded-lg border p-3 transition-colors disabled:opacity-50 ${
          candidate.isCurrent
            ? "border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-900"
            : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-amber-400 dark:hover:border-amber-600"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-medium text-sm text-zinc-900 dark:text-zinc-50">{candidate.name}</p>
              {candidate.rating != null && (
                <span className="text-xs text-amber-600 dark:text-amber-400">{candidate.rating}★</span>
              )}
              {candidate.isCurrent && (
                <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                  目前
                </span>
              )}
            </div>
            {candidate.address && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-1 mt-0.5">
                {candidate.address}
              </p>
            )}
            {candidate.estimated_cost !== undefined && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                💴 {[currency, candidate.estimated_cost.toLocaleString()].filter(Boolean).join(" ")}
              </p>
            )}
          </div>
          {selecting && (
            <svg className="animate-spin w-4 h-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-3">
      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">選擇{mealLabel}</p>

      {loading && (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">搜尋附近餐廳中…</p>
      )}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {!loading && !error && candidates.length === 0 && (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">附近找不到可選的餐廳。</p>
      )}

      <div className="space-y-2">
        {(showAllCandidates ? candidates : candidates.slice(0, VISIBLE_CANDIDATES)).map((candidate) =>
          renderCandidateCard(candidate, candidateKey(candidate))
        )}
      </div>

      {!showAllCandidates && candidates.length > VISIBLE_CANDIDATES && (
        <button
          type="button"
          onClick={() => setShowAllCandidates(true)}
          className="text-xs text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300 transition-colors"
        >
          顯示更多（還有 {candidates.length - VISIBLE_CANDIDATES} 筆）
        </button>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={selectingKey !== null}
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-50 transition-colors"
        >
          取消
        </button>
        <button
          type="button"
          onClick={toggleHistory}
          disabled={selectingKey !== null}
          className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50 transition-colors"
        >
          {showHistory ? "隱藏歷史候選" : "查看歷史候選"}
        </button>
      </div>

      {showHistory && (
        <div className="space-y-3 border-t border-amber-100 dark:border-amber-900/50 pt-3">
          {historyLoading && (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">載入歷史候選中…</p>
          )}
          {historyError && (
            <p className="text-sm text-red-600 dark:text-red-400">{historyError}</p>
          )}
          {!historyLoading && !historyError && historyBatches?.length === 0 && (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">還沒有更早的查詢紀錄。</p>
          )}
          {historyBatches?.map((batch) => {
            const expanded = expandedBatchIds.has(batch.id);
            return (
              <div key={batch.id} className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => toggleBatch(batch.id)}
                  className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  <svg
                    className={`w-3 h-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {formatBatchTime(batch.createdAt)}（{batch.candidates.length} 筆）
                </button>
                {expanded && (
                  <div className="space-y-2">
                    {batch.candidates.map((c) =>
                      renderCandidateCard({ ...c, isCurrent: false }, `hist-${batch.id}-${candidateKey(c)}`)
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {historyNextCursor && (
            <button
              type="button"
              onClick={loadMoreHistory}
              disabled={historyLoadingMore}
              className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50 transition-colors"
            >
              {historyLoadingMore ? "載入中…" : "載入更多歷史"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

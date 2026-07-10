"use client";

import { useEffect, useState } from "react";
import type { Accommodation, AccommodationCandidate } from "@/types/itinerary";

interface AccommodationPickerProps {
  itineraryId: string;
  dayId: string;
  onCancel: () => void;
  onSelected: (accommodation: Accommodation) => void;
}

type HistoryBatch = {
  id: string;
  createdAt: string;
  candidates: AccommodationCandidate[];
};

const candidateKey = (c: AccommodationCandidate) => c.placeId ?? c.name;

const formatBatchTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function AccommodationPicker({
  itineraryId,
  dayId,
  onCancel,
  onSelected,
}: AccommodationPickerProps) {
  const [candidates, setCandidates] = useState<AccommodationCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectingKey, setSelectingKey] = useState<string | null>(null);

  const [showHistory, setShowHistory] = useState(false);
  const [historyBatches, setHistoryBatches] = useState<HistoryBatch[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/days/${dayId}/accommodation/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itineraryId }),
        });
        const resData = await res.json();
        if (!res.ok) throw new Error(resData.error || "取得住宿候選失敗");
        if (!cancelled) setCandidates((resData.candidates ?? []) as AccommodationCandidate[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "取得住宿候選失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dayId, itineraryId]);

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
        `/api/v1/days/${dayId}/accommodation/candidates-history?itineraryId=${encodeURIComponent(itineraryId)}`
      );
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "取得歷史候選失敗");
      // The newest batch is whatever /regenerate just fetched above — skip it
      // here so the same candidates aren't shown twice.
      setHistoryBatches(((resData.history ?? []) as HistoryBatch[]).slice(1));
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "取得歷史候選失敗");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handlePick = async (candidate: AccommodationCandidate) => {
    if (candidate.isCurrent) {
      onCancel();
      return;
    }
    setError(null);
    setSelectingKey(candidateKey(candidate));
    try {
      const accommodation: Accommodation = {
        name: candidate.name,
        area: candidate.area,
        placeId: candidate.placeId,
        lat: candidate.lat,
        lng: candidate.lng,
        address: candidate.address,
        rating: candidate.rating,
        priceLevel: candidate.priceLevel,
      };
      const res = await fetch(`/api/v1/days/${dayId}/accommodation/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itineraryId, accommodation }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "選擇住宿失敗");
      onSelected(resData.accommodation as Accommodation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "選擇住宿失敗");
      setSelectingKey(null);
    }
  };

  const renderCandidateCard = (candidate: AccommodationCandidate, key: string) => {
    const selecting = selectingKey === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => handlePick(candidate)}
        disabled={selectingKey !== null}
        className={`w-full text-left rounded-lg border p-3 transition-colors disabled:opacity-50 ${
          candidate.isCurrent
            ? "border-indigo-300 dark:border-indigo-700 bg-white dark:bg-zinc-900"
            : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-indigo-400 dark:hover:border-indigo-600"
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
                <span className="inline-flex items-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                  目前
                </span>
              )}
            </div>
            {candidate.address && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-1 mt-0.5">
                {candidate.address}
              </p>
            )}
          </div>
          {selecting && (
            <svg className="animate-spin w-4 h-4 shrink-0 text-indigo-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
        </div>
      </button>
    );
  };

  return (
    <div className="mt-4 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 space-y-3">
      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">選擇住宿</p>

      {loading && (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">搜尋附近住宿中…</p>
      )}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {!loading && !error && candidates.length === 0 && (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">附近找不到可選的住宿。</p>
      )}

      <div className="space-y-2">
        {candidates.map((candidate) => renderCandidateCard(candidate, candidateKey(candidate)))}
      </div>

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
        <div className="space-y-3 border-t border-indigo-100 dark:border-indigo-900/50 pt-3">
          {historyLoading && (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">載入歷史候選中…</p>
          )}
          {historyError && (
            <p className="text-sm text-red-600 dark:text-red-400">{historyError}</p>
          )}
          {!historyLoading && !historyError && historyBatches?.length === 0 && (
            <p className="text-sm text-zinc-400 dark:text-zinc-500">還沒有更早的查詢紀錄。</p>
          )}
          {historyBatches?.map((batch) => (
            <div key={batch.id} className="space-y-1.5">
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{formatBatchTime(batch.createdAt)}</p>
              <div className="space-y-2">
                {batch.candidates.map((c) =>
                  renderCandidateCard({ ...c, isCurrent: false }, `hist-${batch.id}-${candidateKey(c)}`)
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

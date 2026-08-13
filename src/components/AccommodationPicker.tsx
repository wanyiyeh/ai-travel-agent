"use client";

import { useEffect, useState } from "react";
import type { Accommodation, AccommodationCandidate } from "@/types/itinerary";
import { PlacePhotoThumb } from "@/components/PlacePhotoThumb";

interface AccommodationPickerProps {
  itineraryId: string;
  dayId: string;
  currency?: string;
  onCancel: () => void;
  onSelected: (accommodation: Accommodation) => void;
}

type HistoryBatch = {
  id: string;
  createdAt: string;
  candidates: AccommodationCandidate[];
};

const VISIBLE_CANDIDATES = 5;

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
  currency,
  onCancel,
  onSelected,
}: AccommodationPickerProps) {
  const [candidates, setCandidates] = useState<AccommodationCandidate[]>([]);
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
        `/api/v1/days/${dayId}/accommodation/candidates-history?itineraryId=${encodeURIComponent(itineraryId)}&cursor=${encodeURIComponent(historyNextCursor)}`
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
        nearestStation: candidate.nearestStation,
        photoName: candidate.photoName,
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
          <PlacePhotoThumb placeId={candidate.placeId} photoName={candidate.photoName} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-medium text-sm text-zinc-900 dark:text-zinc-50">{candidate.name}</p>
              {candidate.rating != null && (
                <span className="text-xs text-amber-600 dark:text-amber-400">{candidate.rating}★</span>
              )}
              {candidate.priceLevel != null && candidate.priceLevel > 0 && (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {"$".repeat(candidate.priceLevel)}
                </span>
              )}
              {candidate.nearestStation && (
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  距{candidate.nearestStation.name}{" "}
                  {candidate.nearestStation.distanceMeters >= 1000
                    ? `${(candidate.nearestStation.distanceMeters / 1000).toFixed(1)}km`
                    : `${candidate.nearestStation.distanceMeters}m`}
                </span>
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
            {candidate.estimated_cost !== undefined && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                💴{" "}
                {candidate.estimated_cost_low !== undefined && candidate.estimated_cost_high !== undefined
                  ? [
                      currency,
                      `${candidate.estimated_cost_low.toLocaleString()}-${candidate.estimated_cost_high.toLocaleString()}`,
                    ]
                      .filter(Boolean)
                      .join(" ")
                  : [currency, candidate.estimated_cost.toLocaleString()].filter(Boolean).join(" ")}
                /晚
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
        {(showAllCandidates ? candidates : candidates.slice(0, VISIBLE_CANDIDATES)).map((candidate) =>
          renderCandidateCard(candidate, candidateKey(candidate))
        )}
      </div>

      {!showAllCandidates && candidates.length > VISIBLE_CANDIDATES && (
        <button
          type="button"
          onClick={() => setShowAllCandidates(true)}
          className="text-xs text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
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

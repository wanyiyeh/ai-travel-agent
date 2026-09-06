"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/types/itinerary";
import type { Stop, StopCandidate } from "@/types/itinerary";
import { CandidateCard } from "@/components/picker/CandidateCard";
import { HistoryPanel, HistoryToggleButton } from "@/components/picker/HistoryPanel";
import { useCandidateHistory } from "@/components/picker/useCandidateHistory";

interface StopPickerProps {
  itineraryId: string;
  dayId: string;
  stopId: string;
  currency?: string;
  onCancel: () => void;
  onSelected: (stop: Stop) => void;
}

const VISIBLE_CANDIDATES = 5;
const ACCENT = "emerald" as const;

const candidateKey = (c: StopCandidate) => c.placeId ?? c.name;

export function StopPicker({
  itineraryId,
  dayId,
  stopId,
  onCancel,
  onSelected,
}: StopPickerProps) {
  const [candidates, setCandidates] = useState<StopCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectingKey, setSelectingKey] = useState<string | null>(null);
  const [showAllCandidates, setShowAllCandidates] = useState(false);

  const history = useCandidateHistory<StopCandidate>(
    `/api/v1/days/${dayId}/stops/${stopId}/candidates-history?itineraryId=${encodeURIComponent(itineraryId)}`
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/days/${dayId}/stop-suggestions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itineraryId, stopId }),
        });
        const resData = await res.json();
        if (!res.ok) throw new Error(resData.error || "取得候選景點失敗");
        if (!cancelled) setCandidates((resData.candidates ?? []) as StopCandidate[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "取得候選景點失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dayId, itineraryId, stopId]);

  const handlePick = async (candidate: StopCandidate) => {
    setError(null);
    setSelectingKey(candidateKey(candidate));
    try {
      const res = await fetch(`/api/v1/stops/${stopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itineraryId,
          name: candidate.name,
          description: candidate.description,
          duration_minutes: candidate.duration_minutes,
          estimated_cost: null,
          placeId: candidate.placeId ?? null,
          lat: candidate.lat,
          lng: candidate.lng,
          address: candidate.address,
          rating: candidate.rating,
          photoName: candidate.photoName ?? null,
        }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "替換景點失敗");
      onSelected(resData.stop as Stop);
    } catch (err) {
      setError(err instanceof Error ? err.message : "替換景點失敗");
      setSelectingKey(null);
    }
  };

  const renderCandidateCard = (candidate: StopCandidate, key: string) => (
    <CandidateCard
      key={key}
      accent={ACCENT}
      photoPlaceId={candidate.placeId}
      photoName={candidate.photoName}
      name={candidate.name}
      rating={candidate.rating}
      addressLine={candidate.address}
      selecting={selectingKey === key}
      disabled={selectingKey !== null}
      onClick={() => handlePick(candidate)}
      badges={
        candidate.suspicious && (
          <span
            title={candidate.suspiciousReason}
            className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
          >
            可疑
          </span>
        )
      }
    >
      {candidate.description && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-2">{candidate.description}</p>
      )}
      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1">
        ⏱ {formatDuration(candidate.duration_minutes)}
      </p>
    </CandidateCard>
  );

  return (
    <div className="mt-3 rounded-lg border p-4 space-y-3 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">換一個景點</p>

      {loading && <p className="text-sm text-zinc-400 dark:text-zinc-500">搜尋附近景點中…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!loading && !error && candidates.length === 0 && (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">附近找不到可選的景點。</p>
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
          className="text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
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
        <HistoryToggleButton history={history} disabled={selectingKey !== null} />
      </div>

      <HistoryPanel accent={ACCENT} history={history} renderCandidate={renderCandidateCard} />
    </div>
  );
}

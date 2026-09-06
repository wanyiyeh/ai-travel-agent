"use client";

import { useEffect, useState } from "react";
import type { Accommodation, AccommodationCandidate } from "@/types/itinerary";
import { CandidateCard } from "@/components/picker/CandidateCard";
import { HistoryPanel, HistoryToggleButton } from "@/components/picker/HistoryPanel";
import { useCandidateHistory } from "@/components/picker/useCandidateHistory";

interface AccommodationPickerProps {
  itineraryId: string;
  dayId: string;
  currency?: string;
  onCancel: () => void;
  onSelected: (accommodation: Accommodation) => void;
}

const VISIBLE_CANDIDATES = 5;
const ACCENT = "indigo" as const;

const candidateKey = (c: AccommodationCandidate) => c.placeId ?? c.name;

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

  const history = useCandidateHistory<AccommodationCandidate>(
    `/api/v1/days/${dayId}/accommodation/candidates-history?itineraryId=${encodeURIComponent(itineraryId)}`
  );

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

  const renderCandidateCard = (candidate: AccommodationCandidate, key: string) => (
    <CandidateCard
      key={key}
      accent={ACCENT}
      photoPlaceId={candidate.placeId}
      photoName={candidate.photoName}
      name={candidate.name}
      rating={candidate.rating}
      isCurrent={candidate.isCurrent}
      addressLine={candidate.address}
      selecting={selectingKey === key}
      disabled={selectingKey !== null}
      onClick={() => handlePick(candidate)}
      badges={
        <>
          {candidate.priceLevel != null && candidate.priceLevel > 0 && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">{"$".repeat(candidate.priceLevel)}</span>
          )}
          {candidate.nearestStation && (
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
              距{candidate.nearestStation.name}{" "}
              {candidate.nearestStation.distanceMeters >= 1000
                ? `${(candidate.nearestStation.distanceMeters / 1000).toFixed(1)}km`
                : `${candidate.nearestStation.distanceMeters}m`}
            </span>
          )}
        </>
      }
    >
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
    </CandidateCard>
  );

  return (
    <div className="mt-4 rounded-lg border p-4 space-y-3 border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20">
      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">選擇住宿</p>

      {loading && <p className="text-sm text-zinc-400 dark:text-zinc-500">搜尋附近住宿中…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
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
        <HistoryToggleButton history={history} disabled={selectingKey !== null} />
      </div>

      <HistoryPanel accent={ACCENT} history={history} renderCandidate={renderCandidateCard} />
    </div>
  );
}

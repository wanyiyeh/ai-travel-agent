"use client";

import { useEffect, useState } from "react";
import type { Meal, MealCandidate, MealType } from "@/types/itinerary";
import { CandidateCard } from "@/components/picker/CandidateCard";
import { HistoryPanel, HistoryToggleButton } from "@/components/picker/HistoryPanel";
import { useCandidateHistory } from "@/components/picker/useCandidateHistory";

interface MealPickerProps {
  itineraryId: string;
  dayId: string;
  mealType: MealType;
  mealLabel: string;
  currency?: string;
  onCancel: () => void;
  onSelected: (meal: Meal) => void;
}

const VISIBLE_CANDIDATES = 5;
const ACCENT = "amber" as const;

const candidateKey = (c: MealCandidate) => c.placeId ?? c.name;

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

  const history = useCandidateHistory<MealCandidate>(
    `/api/v1/days/${dayId}/meals/${mealType}/candidates-history?itineraryId=${encodeURIComponent(itineraryId)}`
  );

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
        photoName: candidate.photoName,
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

  const renderCandidateCard = (candidate: MealCandidate, key: string) => (
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
    >
      {candidate.estimated_cost !== undefined && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
          💴 {[currency, candidate.estimated_cost.toLocaleString()].filter(Boolean).join(" ")}
        </p>
      )}
    </CandidateCard>
  );

  return (
    <div className="mt-3 rounded-lg border p-4 space-y-3 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">選擇{mealLabel}</p>

      {loading && <p className="text-sm text-zinc-400 dark:text-zinc-500">搜尋附近餐廳中…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
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
        <HistoryToggleButton history={history} disabled={selectingKey !== null} />
      </div>

      <HistoryPanel accent={ACCENT} history={history} renderCandidate={renderCandidateCard} />
    </div>
  );
}

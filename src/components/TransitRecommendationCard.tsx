"use client";

import { useState } from "react";
import type { TransitRecommendation } from "@/types/itinerary";

interface TransitRecommendationCardProps {
  recommendation: TransitRecommendation;
  itineraryId: string;
  onInserted: () => void;
  maxDays?: number;
  currentDays?: number;
}

const POPULARITY_LABELS: Record<TransitRecommendation["popularity"], string> = {
  high: "熱門",
  medium: "一般",
  low: "小眾",
};

const POPULARITY_COLORS: Record<TransitRecommendation["popularity"], string> = {
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  low: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export default function TransitRecommendationCard({
  recommendation,
  itineraryId,
  onInserted,
  maxDays,
  currentDays,
}: TransitRecommendationCardProps) {
  const defaultDays = Math.ceil(
    (recommendation.suggestedStayDaysMin + recommendation.suggestedStayDaysMax) / 2
  );
  const [stayDays, setStayDays] = useState(defaultDays);
  const [loading, setLoading] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInsert = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/itinerary/${itineraryId}/insert-waypoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendation, stayDays }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "加入失敗");
      }
      setInserted(true);
      onInserted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入失敗");
    } finally {
      setLoading(false);
    }
  };

  if (inserted) {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4 flex items-center gap-3">
        <svg className="w-5 h-5 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
          {recommendation.name} 已加入行程
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              {recommendation.name}
            </h3>
            {recommendation.type === "country" ? (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">
                國家
              </span>
            ) : (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                城市
              </span>
            )}
            {recommendation.type === "city" && (
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {recommendation.country}
              </span>
            )}
            <span
              className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${POPULARITY_COLORS[recommendation.popularity]}`}
            >
              {POPULARITY_LABELS[recommendation.popularity]}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {recommendation.transitMode} · 約 {recommendation.transitTimeHours} 小時車程
          </p>
        </div>
      </div>

      {/* Top attractions */}
      <div className="px-4 pb-3">
        <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2">
          {recommendation.type === "country" ? "Top 3 必訪城市 / 景點" : "Top 3 必去"}
        </p>
        <ul className="space-y-1">
          {recommendation.topAttractions.map((attraction, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <span className="text-zinc-300 dark:text-zinc-600 shrink-0 font-mono text-xs">
                {i + 1}.
              </span>
              {attraction}
            </li>
          ))}
        </ul>
      </div>

      {/* Day compression notice */}
      {maxDays != null && currentDays != null && currentDays + 1 + stayDays > maxDays && (
        <div className="mx-4 mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          加入後將從原行程移除 {currentDays + 1 + stayDays - maxDays} 天，以配合機票固定的 {maxDays} 天日程
        </div>
      )}

      {/* Footer: stay days stepper + add button */}
      <div className="px-4 pb-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">停留</span>
          <div className="flex items-center border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
            <button
              onClick={() => setStayDays((d) => Math.max(recommendation.suggestedStayDaysMin, d - 1))}
              className="px-2.5 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-sm font-medium"
              aria-label="減少天數"
            >
              −
            </button>
            <span className="px-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50 min-w-[2rem] text-center">
              {stayDays}
            </span>
            <button
              onClick={() => setStayDays((d) => Math.min(recommendation.suggestedStayDaysMax, d + 1))}
              className="px-2.5 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-sm font-medium"
              aria-label="增加天數"
            >
              +
            </button>
          </div>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            天（建議 {recommendation.suggestedStayDaysMin}–{recommendation.suggestedStayDaysMax} 天）
          </span>
        </div>

        <button
          onClick={handleInsert}
          disabled={loading}
          className="shrink-0 flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white transition-colors"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              加入中…
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              加入行程
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="px-4 pb-3 text-xs text-red-600 dark:text-red-400">{error}</div>
      )}
    </div>
  );
}

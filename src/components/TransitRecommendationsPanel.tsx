"use client";

import { useState, useEffect } from "react";
import TransitRecommendationCard from "@/components/TransitRecommendationCard";
import type { TransitRecommendation } from "@/types/itinerary";

interface TransitRecommendationsPanelProps {
  itineraryId: string;
  originIata: string;
  destinationIata: string;
  existingStops?: string[];
  onInserted: () => void;
  maxDays?: number;
  currentDays?: number;
}

type PanelState = "loading" | "ready" | "error" | "empty";

export default function TransitRecommendationsPanel({
  itineraryId,
  originIata,
  destinationIata,
  existingStops,
  onInserted,
  maxDays,
  currentDays,
}: TransitRecommendationsPanelProps) {
  const [state, setState] = useState<PanelState>("loading");
  const [recommendations, setRecommendations] = useState<TransitRecommendation[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchRecommendations() {
      try {
        const res = await fetch(
          `/api/v1/itinerary/${itineraryId}/transit-recommendations`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ originIata, destinationIata, existingStops }),
          }
        );
        if (!res.ok) throw new Error("推薦失敗");
        const data = await res.json() as { recommendations: TransitRecommendation[] };
        if (cancelled) return;
        const existingLower = existingStops?.map((s) => s.toLowerCase()) ?? [];
        const filtered = existingLower.length
          ? data.recommendations.filter(
              (rec) =>
                !existingLower.includes(rec.name.toLowerCase()) &&
                (!rec.iataCode || !existingLower.includes(rec.iataCode.toLowerCase()))
            )
          : data.recommendations;
        if (filtered.length === 0) {
          setState("empty");
        } else {
          setRecommendations(filtered);
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    }

    fetchRecommendations();
    return () => { cancelled = true; };
  }, [itineraryId, originIata, destinationIata, existingStops]);

  if (dismissed) return null;

  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-950/20 overflow-hidden">
      {/* Panel header */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-violet-200 dark:border-violet-800/50">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-violet-600 dark:bg-violet-500 shrink-0">
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-violet-900 dark:text-violet-100">
              順路推薦
            </h3>
            <p className="text-xs text-violet-600 dark:text-violet-400">
              {originIata} → {destinationIata} 途中值得停留的城市
            </p>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-violet-400 hover:text-violet-600 dark:hover:text-violet-300 transition-colors p-1 rounded"
          aria-label="關閉推薦面板"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Panel content */}
      <div className="p-5">
        {state === "loading" && (
          <div className="flex items-center gap-3 py-4 text-sm text-violet-600 dark:text-violet-400">
            <svg className="animate-spin w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            正在分析行程路線，尋找順路城市…
          </div>
        )}

        {state === "error" && (
          <p className="text-sm text-red-600 dark:text-red-400 py-2">
            無法載入推薦，請稍後再試。
          </p>
        )}

        {state === "empty" && (
          <p className="text-sm text-violet-600 dark:text-violet-400 py-2">
            這段路線沒有找到合適的順路城市。
          </p>
        )}

        {state === "ready" && (
          <div className="space-y-3">
            {recommendations.map((rec) => (
              <TransitRecommendationCard
                key={`${rec.name}-${rec.country}`}
                recommendation={rec}
                itineraryId={itineraryId}
                onInserted={onInserted}
                maxDays={maxDays}
                currentDays={currentDays}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

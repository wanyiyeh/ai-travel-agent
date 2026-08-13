"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import TransitRecommendationCard from "@/components/TransitRecommendationCard";
import WaypointCart from "@/components/WaypointCart";
import type { TransitRecommendation, CartItem } from "@/types/itinerary";

interface DaySummary {
  day: number;
  theme: string;
  isTransitDay?: boolean;
}

interface TransitRecommendationsPanelProps {
  itineraryId: string;
  originIata: string;
  destinationIata: string;
  existingStops?: string[];
  maxDays?: number;
  currentDays?: number;
  days?: DaySummary[];
  insertAfterDay?: number;
  onSelectInsertAfterDay?: (day: number) => void;
  cartItems: CartItem[];
  onAddToCart: (rec: TransitRecommendation, stayDays: number) => void;
  onRemoveFromCart: (name: string) => void;
  onUpdateCartStayDays: (name: string, days: number) => void;
  onReorderCart: (items: CartItem[]) => void;
  onBatchApply: () => void;
  isApplying: boolean;
  insertionReason?: string;
  isSingleCity?: boolean;
}

type PanelState = "loading" | "ready" | "error" | "empty";

export default function TransitRecommendationsPanel({
  itineraryId,
  originIata,
  destinationIata,
  existingStops,
  maxDays,
  currentDays,
  days,
  insertAfterDay,
  onSelectInsertAfterDay,
  cartItems,
  onAddToCart,
  onRemoveFromCart,
  onUpdateCartStayDays,
  onReorderCart,
  onBatchApply,
  isApplying,
  insertionReason,
  isSingleCity = false,
}: TransitRecommendationsPanelProps) {
  const [state, setState] = useState<PanelState>("loading");
  const [recommendations, setRecommendations] = useState<TransitRecommendation[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [maxTransitHours, setMaxTransitHours] = useState<number | null>(null);

  const HOUR_FILTERS: { label: string; value: number | null }[] = [
    { label: "不限", value: null },
    { label: "≤ 2 小時", value: 2 },
    { label: "≤ 4 小時", value: 4 },
    { label: "≤ 8 小時", value: 8 },
  ];

  const visibleRecommendations = maxTransitHours === null
    ? recommendations
    : recommendations.filter((r) => r.transitTimeHours <= maxTransitHours);

  // Keep existingStops in a ref so fetchRecommendations can read the latest value
  // without being a dependency (which would cause re-fetches on every insert)
  const existingStopsRef = useRef(existingStops);
  const autoRefreshOnEmptyRef = useRef(false);
  const dismissedNamesRef = useRef<Set<string>>(new Set());

  const cacheKey = `transit-rec-${originIata}-${destinationIata}`;

  const applyRecommendations = useCallback((recs: TransitRecommendation[]) => {
    const existingLower = existingStopsRef.current?.map((s) => s.toLowerCase()) ?? [];
    const dismissed = dismissedNamesRef.current;
    const filtered = recs.filter(
      (rec) =>
        !dismissed.has(rec.name) &&
        !existingLower.includes(rec.name.toLowerCase()) &&
        (!rec.iataCode || !existingLower.includes(rec.iataCode.toLowerCase()))
    );
    if (filtered.length === 0) {
      setState("empty");
    } else {
      setRecommendations(filtered);
      setState("ready");
    }
  }, []);

  // Fetch from API — only re-runs when the route itself changes, not on every insert
  const fetchRecommendations = useCallback((forceRefresh = false) => {
    // Check sessionStorage cache first (skip on manual refresh)
    if (!forceRefresh) {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as TransitRecommendation[];
          applyRecommendations(parsed);
          return () => {};
        }
      } catch {
        // ignore parse errors, fall through to fetch
      }
    }

    setState("loading");
    setRecommendations([]);
    let cancelled = false;

    fetch(`/api/v1/itinerary/${itineraryId}/transit-recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originIata,
        destinationIata,
        existingStops: existingStopsRef.current,
        forceRefresh,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("推薦失敗");
        return res.json() as Promise<{ recommendations: TransitRecommendation[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(data.recommendations));
        } catch {
          // storage quota exceeded — ignore
        }
        applyRecommendations(data.recommendations);
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => { cancelled = true; };
  }, [itineraryId, originIata, destinationIata, cacheKey, applyRecommendations]);

  useEffect(() => {
    // Deferred a microtask so the fetch kickoff (and the setState calls inside
    // fetchRecommendations) doesn't run synchronously in the effect body —
    // avoids react-hooks/set-state-in-effect while firing effectively immediately.
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    queueMicrotask(() => {
      if (cancelled) return;
      cleanup = fetchRecommendations();
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [fetchRecommendations]);

  // When existingStops changes (city inserted), filter locally instead of re-fetching
  useEffect(() => {
    existingStopsRef.current = existingStops;
    queueMicrotask(() => {
      setRecommendations((prev) => {
        if (!prev.length) return prev;
        const existingLower = existingStops?.map((s) => s.toLowerCase()) ?? [];
        if (!existingLower.length) return prev;
        return prev.filter(
          (rec) =>
            !existingLower.includes(rec.name.toLowerCase()) &&
            (!rec.iataCode || !existingLower.includes(rec.iataCode.toLowerCase()))
        );
      });
    });
  }, [existingStops]);

  // Transition to empty state when filtered list runs out; auto-refetch if triggered by individual card skip
  useEffect(() => {
    if (state !== "ready" || recommendations.length !== 0) return;
    queueMicrotask(() => {
      if (autoRefreshOnEmptyRef.current) {
        autoRefreshOnEmptyRef.current = false;
        fetchRecommendations(true);
      } else {
        setState("empty");
      }
    });
  }, [recommendations, state, fetchRecommendations]);

  const handleIndividualRefresh = useCallback((recName: string) => {
    dismissedNamesRef.current.add(recName);
    setRecommendations((prev) => {
      const next = prev.filter((r) => r.name !== recName);
      if (next.length === 0) autoRefreshOnEmptyRef.current = true;
      return next;
    });
  }, []);

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
              {isSingleCity ? "周邊推薦" : "順路推薦"}
            </h3>
            <p className="text-xs text-violet-600 dark:text-violet-400">
              {isSingleCity
                ? `從 ${originIata} 出發可順遊的周邊城市`
                : `${originIata} → ${destinationIata} 途中值得停留的城市`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {state !== "loading" && (
            <button
              onClick={() => fetchRecommendations(true)}
              className="text-violet-400 hover:text-violet-600 dark:hover:text-violet-300 transition-colors p-1 rounded"
              aria-label="換一批推薦"
              title="換一批"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
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
      </div>

      {/* Transit time filter */}
      <div className="px-5 py-2.5 border-b border-violet-200 dark:border-violet-800/50 flex items-center gap-2">
        <span className="text-xs text-violet-500 dark:text-violet-400 shrink-0">車程上限</span>
        <div className="flex gap-1.5">
          {HOUR_FILTERS.map(({ label, value }) => (
            <button
              key={label}
              onClick={() => setMaxTransitHours(value)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                maxTransitHours === value
                  ? "bg-violet-600 text-white dark:bg-violet-500"
                  : "bg-violet-100 text-violet-600 hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:hover:bg-violet-900/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Panel content */}
      <div className="p-5">
        {state === "loading" && (
          <div className="flex items-center gap-3 py-4 text-sm text-violet-600 dark:text-violet-400">
            <svg className="animate-spin w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {isSingleCity ? "正在分析行程，尋找周邊值得一遊的城市…" : "正在分析行程路線，尋找順路城市…"}
          </div>
        )}

        {state === "error" && (
          <div className="text-center py-6">
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
              暫時無法取得推薦，稍後再試看看？
            </p>
            <button
              onClick={() => fetchRecommendations(true)}
              className="text-sm px-4 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
            >
              重新整理
            </button>
          </div>
        )}

        {state === "empty" && (
          <div className="text-center py-4">
            <p className="text-sm text-violet-600 dark:text-violet-400 mb-3">
              {isSingleCity ? "已沒有其他周邊城市可推薦。" : "已沒有其他順路城市可推薦。"}
            </p>
            <button
              onClick={() => fetchRecommendations(true)}
              className="text-sm px-4 py-2 rounded-lg bg-violet-100 hover:bg-violet-200 dark:bg-violet-900/40 dark:hover:bg-violet-900/60 text-violet-700 dark:text-violet-300 transition-colors"
            >
              換一批推薦
            </button>
          </div>
        )}

        {insertionReason && (
          <div className="mb-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 px-3 py-2 text-xs text-indigo-700 dark:text-indigo-300 flex items-start gap-2">
            <span className="shrink-0">💡</span>
            <span>{insertionReason}</span>
          </div>
        )}

        {state === "ready" && visibleRecommendations.length === 0 && (
          <div className="text-center py-4">
            <p className="text-sm text-violet-600 dark:text-violet-400 mb-3">
              目前篩選條件下沒有符合的城市，試試放寬車程上限？
            </p>
            <button
              onClick={() => setMaxTransitHours(null)}
              className="text-sm px-4 py-2 rounded-lg bg-violet-100 hover:bg-violet-200 dark:bg-violet-900/40 dark:hover:bg-violet-900/60 text-violet-700 dark:text-violet-300 transition-colors"
            >
              顯示全部
            </button>
          </div>
        )}

        {state === "ready" && visibleRecommendations.length > 0 && (
          <div className="space-y-3">
            {visibleRecommendations.map((rec) => (
              <TransitRecommendationCard
                key={`${rec.name}-${rec.country}`}
                recommendation={rec}
                isInCart={cartItems.some((i) => i.recommendation.name === rec.name)}
                onAddToCart={onAddToCart}
                onRefresh={() => handleIndividualRefresh(rec.name)}
                maxDays={maxDays}
                currentDays={currentDays}
              />
            ))}
          </div>
        )}

        {cartItems.length > 0 && (
          <WaypointCart
            items={cartItems}
            currentDays={currentDays ?? 0}
            maxDays={maxDays}
            days={days}
            insertAfterDay={insertAfterDay}
            onSelectInsertAfterDay={onSelectInsertAfterDay}
            onUpdateStayDays={onUpdateCartStayDays}
            onRemove={onRemoveFromCart}
            onReorder={onReorderCart}
            onApply={onBatchApply}
            isApplying={isApplying}
          />
        )}
      </div>
    </div>
  );
}

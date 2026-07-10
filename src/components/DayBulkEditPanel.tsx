"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/types/itinerary";
import type { StopCandidate } from "@/types/itinerary";

interface ReusableStop {
  dayNumber: number;
  candidate: StopCandidate;
}

interface DayBulkEditPanelProps {
  itineraryId: string;
  dayId: string;
  reusableStops: ReusableStop[];
  onCancel: () => void;
  onConfirmAdd: (stops: StopCandidate[]) => Promise<void>;
}

type PoolItem = {
  key: string;
  label: string; // e.g. "來自第 3 天" for reuse pool
  candidate: StopCandidate;
};

const normalizeName = (s: string) => s.toLowerCase().trim();
const newItemKey = (c: StopCandidate) => `new-${c.placeId ?? normalizeName(c.name)}`;
const BATCH_SIZE = 4;
const DURATION_STEP = 15;
const DURATION_PRESETS = [60, 120, 180, 240, 360, 480];

export function DayBulkEditPanel({
  itineraryId,
  dayId,
  reusableStops,
  onCancel,
  onConfirmAdd,
}: DayBulkEditPanelProps) {
  // `pool` holds every real candidate fetched so far (the API already returns a
  // larger batch than one display page needs); "換一批" pages through it locally
  // and only calls the API again once the pool runs out.
  const [pool, setPool] = useState<StopCandidate[]>([]);
  const [poolCursor, setPoolCursor] = useState(0);
  const [newCandidates, setNewCandidates] = useState<StopCandidate[]>([]);
  const [seenNewNames, setSeenNewNames] = useState<Set<string>>(new Set());
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  const fetchBatch = async (excludeNames: string[]) => {
    const res = await fetch(`/api/v1/days/${dayId}/stop-suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itineraryId, excludeNames }),
    });
    if (!res.ok) {
      const resData = await res.json();
      throw new Error(resData.error || "取得建議失敗");
    }
    const resData = await res.json();
    return {
      candidates: (resData.candidates ?? []) as StopCandidate[],
      isFallback: !!resData.isFallback,
    };
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { candidates } = await fetchBatch([]);
        if (cancelled) return;
        setPool(candidates);
        setPoolCursor(Math.min(BATCH_SIZE, candidates.length));
        setNewCandidates(candidates.slice(0, BATCH_SIZE));
        setSeenNewNames(new Set(candidates.map((c) => normalizeName(c.name))));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "取得建議失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayId, itineraryId]);

  const handleRefreshBatch = async () => {
    setError(null);

    const kept = newCandidates.filter((c) => selectedKeys.has(newItemKey(c)));
    const needed = BATCH_SIZE - kept.length;

    if (needed <= 0) {
      setNewCandidates(kept);
      return;
    }

    let currentPool = pool;
    let cursor = poolCursor;
    let available = currentPool.slice(cursor, cursor + needed);

    if (available.length < needed) {
      setRefreshing(true);
      try {
        const { candidates: fresh } = await fetchBatch(Array.from(seenNewNames));
        currentPool = [...currentPool, ...fresh];
        setPool(currentPool);
        setSeenNewNames((prev) => new Set([...prev, ...fresh.map((c) => normalizeName(c.name))]));
        setExhausted(fresh.length === 0);
        available = currentPool.slice(cursor, cursor + needed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "取得建議失敗");
        return;
      } finally {
        setRefreshing(false);
      }
    }

    cursor += available.length;
    setPoolCursor(cursor);
    setNewCandidates([...kept, ...available]);
  };

  const reusePool: PoolItem[] = reusableStops.map(({ dayNumber, candidate }, i) => ({
    key: `reuse-${i}-${candidate.placeId ?? candidate.name}`,
    label: `來自第 ${dayNumber} 天`,
    candidate,
  }));

  const newPool: PoolItem[] = newCandidates.map((candidate) => ({
    key: newItemKey(candidate),
    label: "新候選景點",
    candidate,
  }));

  const toggleSelect = (item: PoolItem) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(item.key)) {
        next.delete(item.key);
      } else {
        next.add(item.key);
        setDurations((d) => ({ ...d, [item.key]: d[item.key] ?? item.candidate.duration_minutes }));
      }
      return next;
    });
  };

  const adjustDuration = (key: string, delta: number) => {
    setDurations((d) => ({ ...d, [key]: Math.max(DURATION_STEP, (d[key] ?? DURATION_STEP) + delta) }));
  };

  const handleConfirm = async () => {
    const all = [...reusePool, ...newPool];
    const chosen: StopCandidate[] = all
      .filter((item) => selectedKeys.has(item.key))
      .map((item) => ({
        ...item.candidate,
        duration_minutes: durations[item.key] ?? item.candidate.duration_minutes,
      }));
    if (chosen.length === 0) {
      onCancel();
      return;
    }
    setSubmitting(true);
    try {
      await onConfirmAdd(chosen);
    } finally {
      setSubmitting(false);
    }
  };

  const renderPoolItem = (item: PoolItem) => {
    const selected = selectedKeys.has(item.key);
    return (
      <div
        key={item.key}
        className={`rounded-lg border p-3 transition-colors ${
          selected
            ? "border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/40"
            : "border-zinc-200 dark:border-zinc-700"
        }`}
      >
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => toggleSelect(item)}
            className="mt-1 w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-medium text-sm text-zinc-900 dark:text-zinc-50">{item.candidate.name}</p>
              {item.candidate.rating != null && (
                <span className="text-xs text-amber-600 dark:text-amber-400">{item.candidate.rating}★</span>
              )}
              <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{item.label}</span>
              {item.candidate.suspicious && (
                <span
                  title={item.candidate.suspiciousReason}
                  className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                >
                  可疑
                </span>
              )}
            </div>
            {item.candidate.address && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-1 mt-0.5">
                {item.candidate.address}
              </p>
            )}
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{item.candidate.description}</p>
            {selected && (
              <div className="mt-2 space-y-1.5">
                <div className="flex flex-wrap gap-1">
                  {DURATION_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setDurations((d) => ({ ...d, [item.key]: preset }))}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                        (durations[item.key] ?? item.candidate.duration_minutes) === preset
                          ? "bg-blue-600 text-white"
                          : "bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600"
                      }`}
                    >
                      {formatDuration(preset)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-zinc-500 dark:text-zinc-400">停留時間</label>
                  <button
                    type="button"
                    onClick={() => adjustDuration(item.key, -DURATION_STEP)}
                    className="w-6 h-6 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                    aria-label="減少停留時間"
                  >
                    −
                  </button>
                  <span className="min-w-14 text-center text-xs font-medium text-zinc-900 dark:text-zinc-50">
                    {formatDuration(durations[item.key] ?? item.candidate.duration_minutes)}
                  </span>
                  <button
                    type="button"
                    onClick={() => adjustDuration(item.key, DURATION_STEP)}
                    className="w-6 h-6 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                    aria-label="增加停留時間"
                  >
                    +
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-4">
      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">要不要推薦其他景點？</p>

      {reusePool.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
            其他天已出現的景點
          </p>
          <div className="space-y-2">{reusePool.map(renderPoolItem)}</div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
            新候選景點
          </p>
          {!loading && !exhausted && (
            <button
              onClick={handleRefreshBatch}
              disabled={refreshing}
              className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50 transition-colors"
            >
              <svg className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {refreshing ? "換一批中…" : "換一批"}
            </button>
          )}
        </div>
        {loading && (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">載入建議中…</p>
        )}
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {!loading && !error && newPool.length === 0 && (
          <p className="text-sm text-zinc-400 dark:text-zinc-500">目前沒有新的建議景點。</p>
        )}
        {exhausted && (
          <p className="text-xs text-zinc-400 dark:text-zinc-500">附近沒有更多建議景點了。</p>
        )}
        <div className="space-y-2">{newPool.map(renderPoolItem)}</div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleConfirm}
          disabled={submitting}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? "加入中…" : `加入行程${selectedKeys.size > 0 ? `（${selectedKeys.size}）` : ""}`}
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          className="px-4 py-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-sm rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors"
        >
          跳過，完成編輯
        </button>
      </div>
    </div>
  );
}

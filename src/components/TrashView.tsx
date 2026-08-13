"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDuration } from "@/types/itinerary";
import type { Stop, DayWithId } from "@/types/itinerary";
import { PlacePhotoThumb } from "@/components/PlacePhotoThumb";

interface TrashEntry {
  id: string;
  dayId: string;
  dayNumber: number;
  deletedAt: string;
  stop: Stop;
}

interface TrashDayEntry {
  id: string;
  deletedAt: string;
  day: DayWithId;
}

interface TrashViewProps {
  itineraryId: string;
}

function formatDeletedAt(iso: string): string {
  const deletedAt = new Date(iso);
  const diffMs = Date.now() - deletedAt.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "剛剛";
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小時前`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay} 天前`;
}

export default function TrashView({ itineraryId }: TrashViewProps) {
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [dayEntries, setDayEntries] = useState<TrashDayEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [res, daysRes] = await Promise.all([
          fetch(`/api/v1/itinerary/${itineraryId}/trash`),
          fetch(`/api/v1/itinerary/${itineraryId}/trash/days`),
        ]);
        const data = await res.json();
        const daysData = await daysRes.json();
        if (!res.ok) throw new Error(data.error || "讀取垃圾桶失敗");
        if (!daysRes.ok) throw new Error(daysData.error || "讀取垃圾桶失敗");
        if (!cancelled) {
          setEntries(data.entries as TrashEntry[]);
          setDayEntries(daysData.entries as TrashDayEntry[]);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "讀取垃圾桶失敗");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itineraryId]);

  const handleRestoreDay = async (entry: TrashDayEntry) => {
    setError(null);
    setBusyId(entry.id);
    try {
      const res = await fetch(`/api/v1/itinerary/${itineraryId}/trash/days/${entry.id}/restore`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "復原失敗");
      setDayEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "復原失敗");
    } finally {
      setBusyId(null);
    }
  };

  const handlePurgeDay = async (entry: TrashDayEntry) => {
    if (!confirm(`確定要永久刪除「${entry.day.theme || "這一天"}」嗎？此動作無法復原。`)) return;
    setError(null);
    setBusyId(entry.id);
    try {
      const res = await fetch(`/api/v1/itinerary/${itineraryId}/trash/days/${entry.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "永久刪除失敗");
      setDayEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "永久刪除失敗");
    } finally {
      setBusyId(null);
    }
  };

  const handleRestore = async (entry: TrashEntry) => {
    setError(null);
    setBusyId(entry.id);
    try {
      const res = await fetch(`/api/v1/itinerary/${itineraryId}/trash/${entry.id}/restore`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "復原失敗");
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "復原失敗");
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async (entry: TrashEntry) => {
    if (!confirm(`確定要永久刪除「${entry.stop.name}」嗎？此動作無法復原。`)) return;
    setError(null);
    setBusyId(entry.id);
    try {
      const res = await fetch(`/api/v1/itinerary/${itineraryId}/trash/${entry.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "永久刪除失敗");
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "永久刪除失敗");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">垃圾桶</h1>
        <Link
          href={`/view/${itineraryId}`}
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4"
        >
          返回行程
        </Link>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && <p className="text-sm text-zinc-400 dark:text-zinc-500">載入中…</p>}
      {!loading && entries.length === 0 && dayEntries.length === 0 && (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">垃圾桶是空的。</p>
      )}

      {dayEntries.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">整天</h2>
          {dayEntries.map((entry) => {
            const busy = busyId === entry.id;
            const stopCount = entry.day.stops?.length ?? 0;
            return (
              <div
                key={entry.id}
                className="rounded-lg border p-3 border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm text-zinc-900 dark:text-zinc-50">
                      {entry.day.theme || "未命名的一天"}
                    </p>
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                      {stopCount} 個景點 · {formatDeletedAt(entry.deletedAt)}刪除
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRestoreDay(entry)}
                      disabled={busy}
                      className="text-xs px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      {busy ? "處理中…" : "復原"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePurgeDay(entry)}
                      disabled={busy}
                      className="text-xs px-2.5 py-1 rounded-md text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 transition-colors"
                    >
                      永久刪除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        {entries.length > 0 && dayEntries.length > 0 && (
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">單一景點</h2>
        )}
        {entries.map((entry) => {
          const busy = busyId === entry.id;
          return (
            <div
              key={entry.id}
              className="rounded-lg border p-3 border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-2">
                <PlacePhotoThumb placeId={entry.stop.placeId} photoName={entry.stop.photoName} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-medium text-sm text-zinc-900 dark:text-zinc-50">{entry.stop.name}</p>
                    {entry.stop.rating != null && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">{entry.stop.rating}★</span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                    Day {entry.dayNumber} · {formatDeletedAt(entry.deletedAt)}刪除
                  </p>
                  {entry.stop.address && (
                    <p className="text-[11px] text-zinc-400 dark:text-zinc-500 line-clamp-1 mt-0.5">
                      {entry.stop.address}
                    </p>
                  )}
                  {entry.stop.description && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-2">
                      {entry.stop.description}
                    </p>
                  )}
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                    ⏱ {formatDuration(entry.stop.duration_minutes)}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleRestore(entry)}
                    disabled={busy}
                    className="text-xs px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {busy ? "處理中…" : "復原"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePurge(entry)}
                    disabled={busy}
                    className="text-xs px-2.5 py-1 rounded-md text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 transition-colors"
                  >
                    永久刪除
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

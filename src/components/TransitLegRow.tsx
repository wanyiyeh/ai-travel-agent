"use client";

import { useSortableItem } from "@/hooks/useSortableItem";
import { formatDuration } from "@/types/itinerary";
import type { Stop } from "@/types/itinerary";

/**
 * A transit day's ride between cities (ADR-0009): shown as a leg, not a
 * place. It can't be dragged, swapped, moved or deleted, but it stays a drop
 * target so a stop can be dropped right before or after it.
 */
export function TransitLegRow({ stop, currency }: { stop: Stop; currency?: string }) {
  const { setNodeRef, style } = useSortableItem(stop.id!, {
    disabled: { draggable: true, droppable: false },
  });

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 rounded-lg border border-dashed border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/30 px-4 py-3"
    >
      <span className="text-lg leading-none mt-0.5" aria-hidden>
        🚆
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-indigo-900 dark:text-indigo-100 leading-snug">{stop.name}</p>
        {stop.description && (
          <p className="mt-0.5 text-sm text-indigo-700/80 dark:text-indigo-300/80 leading-relaxed">{stop.description}</p>
        )}
        <p className="mt-1 text-xs text-indigo-600 dark:text-indigo-400 font-medium">
          {stop.duration_minutes > 0 && <>⏱ {formatDuration(stop.duration_minutes)}</>}
          {stop.estimated_cost !== undefined && stop.estimated_cost > 0 && (
            <span className="ml-2 text-emerald-600 dark:text-emerald-400">
              💴 {[currency, stop.estimated_cost.toLocaleString()].filter(Boolean).join(" ")}
            </span>
          )}
        </p>
        <p className="mt-1 text-[11px] text-indigo-500/80 dark:text-indigo-400/70">移動日的交通，位置固定；景點可以拖到它的前面或後面。</p>
      </div>
    </div>
  );
}

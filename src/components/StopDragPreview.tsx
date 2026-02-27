"use client";

import { formatDuration } from "@/types/itinerary";
import type { Stop } from "@/types/itinerary";

export function StopDragPreview({ stop }: { stop: Stop }) {
  return (
    <div className="bg-white dark:bg-zinc-800 shadow-xl rounded-xl p-4 border-2 border-blue-400 w-80">
      <p className="font-semibold text-zinc-900 dark:text-zinc-50">{stop.name}</p>
      <p className="text-zinc-500 dark:text-zinc-400 text-sm truncate mt-0.5">
        {stop.description}
      </p>
      {stop.duration_minutes > 0 && (
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 font-medium">
          ⏱ {formatDuration(stop.duration_minutes)}
        </p>
      )}
    </div>
  );
}

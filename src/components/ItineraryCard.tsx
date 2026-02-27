"use client";

import { formatDuration } from "@/types/itinerary";
import type { Itinerary } from "@/types/itinerary";

interface ItineraryCardProps {
  data: Itinerary;
}

export default function ItineraryCard({ data }: ItineraryCardProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          {data.title}
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          共 {data.days.length} 天行程
        </p>
      </div>

      {data.days.map((day, dayIdx) => {
        const totalMinutes = day.stops.reduce(
          (sum, s) => sum + (s.duration_minutes || 0),
          0
        );
        return (
          <div
            key={day.id || dayIdx}
            className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden"
          >
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-5 py-4 flex items-center justify-between">
              <div className="text-lg font-bold text-white">
                第 {day.day} 天
                {day.theme && (
                  <span className="text-sm font-normal ml-2 opacity-90">
                    · {day.theme}
                  </span>
                )}
              </div>
              {totalMinutes > 0 && (
                <div className="text-sm text-white opacity-90">
                  總時長：{formatDuration(totalMinutes)}
                </div>
              )}
            </div>

            <div className="p-5 space-y-4">
              {day.stops.map((stop, stopIdx) => (
                <div
                  key={stop.id || stopIdx}
                  className="flex gap-4 pb-4 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 last:pb-0"
                >
                  <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                    {stopIdx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                      {stop.name}
                    </p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {stop.description}
                    </p>
                    {stop.duration_minutes > 0 && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                        ⏱ {formatDuration(stop.duration_minutes)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { formatDuration } from "@/types/itinerary";
import type { Day } from "@/types/itinerary";

// Mirrors useStreamingGenerate's TripPlanPreview — the rule-engine path's
// "plan" SSE event (plan/hybrid-rule-engine-scheduling.md Phase 5(c)),
// available well before any day content is ready.
interface TripPlanPreview {
  title: string;
  currency: string;
  cities: Array<{ name: string; days: number }>;
}

interface StreamingPreviewProps {
  partialData: string;
  days: number;
  retryInfo?: { attempt: number; maxAttempts: number } | null;
  // Rule-engine path preview state — undefined/empty while the old free-form
  // LLM path is the one streaming (it never sends "plan"/"day" events).
  plan?: TripPlanPreview | null;
  liveDays?: Day[];
}

function StreamingBanner({ retryInfo }: { retryInfo?: { attempt: number; maxAttempts: number } | null }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
      <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
      <div>
        <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
          {retryInfo
            ? `AI 發現行程有問題，正在重新生成（第 ${retryInfo.attempt}/${retryInfo.maxAttempts} 次嘗試）`
            : "AI 正在即時生成行程內容"}
        </p>
        <p className="text-xs text-blue-700 dark:text-blue-300">您可以看到生成過程，請稍候...</p>
      </div>
    </div>
  );
}

function DayCard({ day, idx }: { day: Record<string, unknown>; idx: number }) {
  const stops = (day.stops as Array<Record<string, unknown>> | undefined) ?? [];
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden animate-fade-in">
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-5 py-4">
        <div className="text-lg font-bold text-white">
          第 {(day.day as number | undefined) ?? idx + 1} 天
          {typeof day.theme === "string" && day.theme && (
            <span className="text-sm font-normal ml-2 opacity-90">· {day.theme}</span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {stops.map((stop, stopIdx) => (
          <div
            key={stopIdx}
            className="flex gap-4 pb-4 border-b border-zinc-100 dark:border-zinc-800 last:border-b-0 last:pb-0"
          >
            <div className="shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center text-sm">
              📍
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-zinc-900 dark:text-zinc-50">{stop.name as string}</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{stop.description as string}</p>
              {typeof stop.duration_minutes === "number" && (
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
}

function SkeletonDayCard() {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden animate-pulse">
      <div className="h-14 bg-zinc-200 dark:bg-zinc-700" />
      <div className="p-5 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4">
            <div className="w-8 h-8 bg-zinc-200 dark:bg-zinc-700 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-3/4" />
              <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded w-full" />
              <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded w-1/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StreamingPreview({
  partialData,
  days,
  retryInfo,
  plan,
  liveDays = [],
}: StreamingPreviewProps) {
  // Rule-engine path: the "plan" event lands almost immediately (a single
  // small LLM call, no candidate-pool lookups yet), so the city/day skeleton
  // shows up well before the first real day does — the "秒回骨架" this
  // protocol exists for. Real days replace skeleton slots as "day" events
  // arrive, in order (the backend generates cities sequentially).
  if (plan) {
    const totalPlannedDays = plan.cities.reduce((sum, c) => sum + c.days, 0) + 1; // +1 for the departure day
    const remainingSkeletonCount = Math.max(0, totalPlannedDays - liveDays.length);

    return (
      <div className="space-y-6">
        <StreamingBanner retryInfo={retryInfo} />

        <div className="text-center animate-fade-in space-y-1">
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{plan.title}</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {plan.cities.map((c) => `${c.name} ${c.days}天`).join(" → ")}
          </p>
        </div>

        <div className="space-y-4">
          {liveDays.map((day, idx) => (
            <DayCard key={day.id ?? idx} day={day as unknown as Record<string, unknown>} idx={idx} />
          ))}
          {Array.from({ length: remainingSkeletonCount }).map((_, idx) => (
            <SkeletonDayCard key={`skeleton-${idx}`} />
          ))}
        </div>

        {liveDays.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-400 hover:text-zinc-600">
              開發者檢視：即時事件串流
            </summary>
            <pre className="mt-2 p-3 bg-zinc-900 text-green-400 rounded overflow-x-auto text-xs">
              {JSON.stringify({ plan, days: liveDays }, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  }

  // Old free-form LLM path: no structured events, only an accumulating raw
  // JSON string — parse what we can, falling back to regex-based partial
  // extraction while the JSON is still incomplete.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsedData: any = null;
  let showSkeleton = true;

  if (partialData) {
    try {
      parsedData = JSON.parse(partialData);
      showSkeleton = false;
    } catch {
      // Try regex-based partial extraction
      const titleMatch = partialData.match(/"title":\s*"([^"]+)"/);
      if (titleMatch) {
        parsedData = { title: titleMatch[1], days: [] };
        showSkeleton = false;
      }

      const daysMatch = partialData.match(/"days":\s*\[([\s\S]+)/);
      if (daysMatch) {
        try {
          let daysText = daysMatch[1];
          const openBrackets = (daysText.match(/\[/g) || []).length;
          const closeBrackets = (daysText.match(/\]/g) || []).length;
          const openBraces = (daysText.match(/\{/g) || []).length;
          const closeBraces = (daysText.match(/\}/g) || []).length;
          daysText += "}".repeat(Math.max(0, openBraces - closeBraces));
          daysText += "]".repeat(Math.max(0, openBrackets - closeBrackets + 1));
          const partial = JSON.parse(`{"days":[${daysText}]}`);
          if (!parsedData) parsedData = {};
          parsedData.days = partial.days;
          showSkeleton = false;
        } catch {
          // Keep showing skeleton with title only
        }
      }
    }
  }

  return (
    <div className="space-y-6">
      <StreamingBanner retryInfo={retryInfo} />

      {/* Preview content */}
      {parsedData && !showSkeleton ? (
        <div className="space-y-4">
          {parsedData.title && (
            <div className="text-center animate-fade-in">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{parsedData.title}</h2>
            </div>
          )}

          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {parsedData.days?.map((day: any, idx: number) => (
            <DayCard key={idx} day={day} idx={idx} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from({ length: days }).map((_, idx) => (
            <SkeletonDayCard key={idx} />
          ))}
        </div>
      )}

      {/* Dev: raw JSON stream */}
      {partialData && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-400 hover:text-zinc-600">
            開發者檢視：即時 JSON 串流
          </summary>
          <pre className="mt-2 p-3 bg-zinc-900 text-green-400 rounded overflow-x-auto text-xs">{partialData}</pre>
        </details>
      )}
    </div>
  );
}

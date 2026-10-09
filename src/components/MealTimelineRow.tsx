"use client";

import type { Meal, MealType } from "@/types/itinerary";
import { InlinePriceEditor } from "@/components/InlinePriceEditor";
import { PlacePhotoThumb } from "@/components/PlacePhotoThumb";
import { buildPlaceMapsUrl } from "@/lib/googleMapsUrl";

export const MEAL_META: Record<MealType, { label: string; icon: string }> = {
  breakfast: { label: "早餐", icon: "🌅" },
  lunch: { label: "午餐", icon: "☀️" },
  snack: { label: "點心", icon: "🍰" },
  dinner: { label: "晚餐", icon: "🌙" },
  nightcap: { label: "小酌", icon: "🍷" },
};

interface MealTimelineRowProps {
  mealType: MealType;
  meal: Meal | null;
  currency?: string;
  // False for a day without an id yet (mid-stream) — nothing to save against.
  editable: boolean;
  isPicking: boolean;
  onPick: () => void;
  onSaveCost: (value: number | undefined) => Promise<void>;
  /** Shown when this place already came earlier in the trip, e.g. "第 2 次・上次在第 3 天". */
  repeatNote?: string;
}

/**
 * A meal shown inline in a day's stop timeline (see lib/dayTimeline.ts for
 * where it's placed). Not draggable — meals are positioned by type, not by
 * the user — but can be swapped and repriced like the old meal grid.
 */
export function MealTimelineRow({
  mealType,
  meal,
  currency,
  editable,
  isPicking,
  onPick,
  onSaveCost,
  repeatNote,
}: MealTimelineRowProps) {
  const { label, icon } = MEAL_META[mealType];

  return (
    <div className="flex gap-4">
      <div className="shrink-0 w-9 h-9 rounded-full bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-base">
        <span aria-hidden>{icon}</span>
      </div>

      {meal ? (
        <>
          <PlacePhotoThumb placeId={meal.placeId} photoName={meal.photoName} size={64} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  {label}
                  {repeatNote && (
                    <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-0.5 font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      {repeatNote}
                    </span>
                  )}
                </p>
                <p className="font-semibold text-zinc-800 dark:text-zinc-200 leading-snug">{meal.name}</p>
              </div>
              {editable && !isPicking && (
                <button
                  onClick={onPick}
                  className="shrink-0 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                >
                  換一家
                </button>
              )}
            </div>
            {meal.description && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 leading-snug">{meal.description}</p>
            )}
            {meal.address && (
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs text-zinc-400 dark:text-zinc-500 leading-tight line-clamp-1">{meal.address}</span>
                {meal.placeId && (
                  <a
                    href={buildPlaceMapsUrl(meal.placeId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300 transition-colors"
                    title="在 Google Maps 上導航"
                  >
                    ↗
                  </a>
                )}
              </div>
            )}
            {editable && (
              <p className="mt-1">
                <InlinePriceEditor value={meal.estimated_cost} currency={currency} onSave={onSaveCost} />
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 min-w-0 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-700 px-3 py-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">{label}</p>
          {editable && !isPicking && (
            <button
              onClick={onPick}
              className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
            >
              選擇{label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

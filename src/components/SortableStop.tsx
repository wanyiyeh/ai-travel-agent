"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatDuration } from "@/types/itinerary";
import type { Stop } from "@/types/itinerary";

const DURATION_STEP = 15;
const DURATION_PRESETS = [30, 60, 90, 120, 180, 240];

type EditingStop = {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
};

interface SortableStopProps {
  stop: Stop;
  index: number;
  dayIndex: number;
  currency?: string;
  editingStop: EditingStop | null;
  isLoading: boolean;
  bulkMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (stopId: string) => void;
  isDuplicate?: boolean;
  duplicateReason?: string;
  onEdit: (stop: Stop) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditChange: (updated: EditingStop) => void;
}

export function SortableStop({
  stop,
  index,
  dayIndex,
  currency,
  editingStop,
  isLoading,
  bulkMode = false,
  selected = false,
  onToggleSelect,
  isDuplicate,
  duplicateReason,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onEditChange,
}: SortableStopProps) {
  const isEditing = editingStop?.id === stop.id;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: stop.id!,
    disabled: isEditing || isLoading || bulkMode,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex gap-4 pb-6 last:pb-0 border-b last:border-b-0 border-zinc-100 dark:border-zinc-800 transition-opacity${
        isLoading ? " opacity-50" : ""
      }${isDragging ? " opacity-30" : ""}`}
    >
      {/* Drag handle */}
      <div className="shrink-0">
        <div
          className={`w-9 h-9 bg-blue-50 dark:bg-blue-950 rounded-full flex items-center justify-center${
            isEditing || isLoading ? "" : " cursor-grab active:cursor-grabbing"
          }`}
          {...(isEditing || isLoading ? {} : { ...attributes, ...listeners })}
        >
          {/* Grip icon */}
          <svg
            className="w-4 h-4 text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8h16M4 16h16"
            />
          </svg>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isEditing && editingStop ? (
          <div className="space-y-3">
            <input
              type="text"
              value={editingStop.name}
              onChange={(e) =>
                onEditChange({ ...editingStop, name: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="景點名稱"
            />
            <textarea
              value={editingStop.description}
              onChange={(e) =>
                onEditChange({ ...editingStop, description: e.target.value })
              }
              className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="景點描述"
            />
            <div className="space-y-2">
              <label className="text-sm text-zinc-500 dark:text-zinc-400">
                停留時間
              </label>
              <div className="flex flex-wrap gap-1.5">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() =>
                      onEditChange({ ...editingStop, duration_minutes: preset })
                    }
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      editingStop.duration_minutes === preset
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600"
                    }`}
                  >
                    {formatDuration(preset)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    onEditChange({
                      ...editingStop,
                      duration_minutes: Math.max(
                        DURATION_STEP,
                        editingStop.duration_minutes - DURATION_STEP
                      ),
                    })
                  }
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                  aria-label="減少停留時間"
                >
                  −
                </button>
                <span className="min-w-16 text-center text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {formatDuration(editingStop.duration_minutes)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onEditChange({
                      ...editingStop,
                      duration_minutes: editingStop.duration_minutes + DURATION_STEP,
                    })
                  }
                  className="w-7 h-7 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                  aria-label="增加停留時間"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onSaveEdit}
                disabled={isLoading}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                儲存
              </button>
              <button
                onClick={onCancelEdit}
                disabled={isLoading}
                className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-1.5 mb-1">
              <p className="font-semibold text-zinc-900 dark:text-zinc-50 leading-snug">
                {stop.name}
              </p>
              {stop.suspicious && (
                <span
                  title={stop.suspiciousReason ?? "地點可能搜尋有誤"}
                  className="mt-0.5 shrink-0 inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                >
                  <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  可疑
                </span>
              )}
              {isDuplicate && (
                <span
                  title={duplicateReason ?? "與其他天景點重複"}
                  className="mt-0.5 shrink-0 inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                >
                  <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                  </svg>
                  重複
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed mb-2">
              {stop.description}
            </p>
            {stop.address && (
              <div className="flex items-center gap-1 mb-1.5">
                <svg className="w-3 h-3 shrink-0 text-zinc-300 dark:text-zinc-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 00.281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 103 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 002.273 1.765 11.842 11.842 0 00.976.544l.062.029.018.008.006.003ZM10 11.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5Z" clipRule="evenodd" />
                </svg>
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-tight line-clamp-1">
                  {stop.address}
                </span>
                {stop.placeId && (
                  <a
                    href={`https://www.google.com/maps/place/?q=place_id:${stop.placeId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-[11px] text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300 transition-colors"
                    title="在 Google Maps 上驗證"
                  >
                    ↗
                  </a>
                )}
              </div>
            )}
            {stop.duration_minutes > 0 && (
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                ⏱ {formatDuration(stop.duration_minutes)}
              </p>
            )}
            {stop.estimated_cost !== undefined && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
                {stop.estimated_cost === 0
                  ? "免費"
                  : `💴 ${[currency, stop.estimated_cost.toLocaleString()].filter(Boolean).join(" ")}`}
              </p>
            )}
          </>
        )}
      </div>

      {/* Actions + index badge */}
      <div className="shrink-0 flex flex-col items-center gap-2">
        <div className="w-7 h-7 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center">
          <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">
            {index + 1}
          </span>
        </div>

        {bulkMode && stop.id ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(stop.id!)}
            className="w-5 h-5 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
            title={selected ? "保留這個景點" : "將刪除這個景點"}
          />
        ) : (
          !isEditing && stop.id && (
            <div className="flex gap-1">
              <button
                onClick={() => onEdit(stop)}
                disabled={isLoading || editingStop !== null}
                className="p-1 text-zinc-400 hover:text-blue-600 disabled:opacity-30 transition-colors"
                title="編輯"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
              </button>
            </div>
          )
        )}
      </div>
    </div>
  );
}

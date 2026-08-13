"use client";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CartItem, TransitRecommendation } from "@/types/itinerary";

interface DaySummary {
  day: number;
  theme: string;
  isTransitDay?: boolean;
}

interface WaypointCartProps {
  items: CartItem[];
  currentDays: number;
  maxDays?: number;
  days?: DaySummary[];
  insertAfterDay?: number;
  onSelectInsertAfterDay?: (day: number) => void;
  onUpdateStayDays: (name: string, days: number) => void;
  onRemove: (name: string) => void;
  onReorder: (items: CartItem[]) => void;
  onApply: () => void;
  isApplying: boolean;
}

function SortableCartItem({
  item,
  onUpdateStayDays,
  onRemove,
}: {
  item: CartItem;
  onUpdateStayDays: (name: string, days: number) => void;
  onRemove: (name: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.recommendation.name });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const rec = item.recommendation as TransitRecommendation;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2.5"
    >
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 text-zinc-300 dark:text-zinc-600 cursor-grab active:cursor-grabbing touch-none"
        aria-label="拖曳排序"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
        </svg>
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
          {item.recommendation.name}
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
          {item.recommendation.transitMode} · {item.recommendation.transitTimeHours}h
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() =>
            onUpdateStayDays(
              rec.name,
              Math.max(rec.suggestedStayDaysMin, item.stayDays - 1)
            )
          }
          className="w-6 h-6 flex items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm transition-colors"
          aria-label="減少天數"
        >
          −
        </button>
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 w-5 text-center">
          {item.stayDays}
        </span>
        <button
          onClick={() =>
            onUpdateStayDays(
              rec.name,
              Math.min(rec.suggestedStayDaysMax, item.stayDays + 1)
            )
          }
          className="w-6 h-6 flex items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm transition-colors"
          aria-label="增加天數"
        >
          +
        </button>
        <span className="text-xs text-zinc-400 ml-0.5">天</span>
      </div>

      <button
        onClick={() => onRemove(item.recommendation.name)}
        className="shrink-0 text-zinc-300 dark:text-zinc-600 hover:text-red-400 dark:hover:text-red-400 transition-colors"
        aria-label={`移除 ${item.recommendation.name}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export default function WaypointCart({
  items,
  currentDays,
  maxDays,
  days,
  insertAfterDay,
  onSelectInsertAfterDay,
  onUpdateStayDays,
  onRemove,
  onReorder,
  onApply,
  isApplying,
}: WaypointCartProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  // Each city adds 1 transit day + stayDays
  const totalInserted = items.reduce((sum, item) => sum + 1 + item.stayDays, 0);
  const newTotal = currentDays + totalInserted;
  const isOverLimit = maxDays != null && newTotal > maxDays;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.recommendation.name === active.id);
    const newIndex = items.findIndex((i) => i.recommendation.name === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <div className="mt-4 rounded-xl border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-950/20 overflow-hidden">
      <div className="px-4 py-3 border-b border-blue-200 dark:border-blue-800/50">
        <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100">
          待選清單（{items.length}）
        </h4>
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
          拖曳可調整城市順序
        </p>
      </div>

      <div className="p-4 space-y-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map((i) => i.recommendation.name)}
            strategy={verticalListSortingStrategy}
          >
            {items.map((item) => (
              <SortableCartItem
                key={item.recommendation.name}
                item={item}
                onUpdateStayDays={onUpdateStayDays}
                onRemove={onRemove}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* Insertion point selector */}
        {days && days.length > 1 && onSelectInsertAfterDay && (
          <div className="mt-2">
            <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">
              插入在第幾天之後
            </label>
            <select
              value={insertAfterDay ?? ""}
              onChange={(e) => onSelectInsertAfterDay(Number(e.target.value))}
              className="w-full text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-2 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {days.slice(0, -1).map((d) => (
                <option key={d.day} value={d.day}>
                  第 {d.day} 天之後{d.isTransitDay ? "（移動日）" : ""} · {d.theme.length > 16 ? d.theme.slice(0, 16) + "…" : d.theme}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Day count summary */}
        <div
          className={`rounded-lg border p-3 mt-1 ${
            isOverLimit
              ? "border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20"
              : "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50"
          }`}
        >
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-zinc-500 dark:text-zinc-400">原有天數</span>
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">{currentDays} 天</span>
          </div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-zinc-500 dark:text-zinc-400">新增天數</span>
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">+{totalInserted} 天</span>
          </div>
          <div
            className={`flex items-center justify-between text-xs font-bold border-t pt-1.5 mt-1 ${
              isOverLimit
                ? "border-amber-200 dark:border-amber-800/50 text-zinc-900 dark:text-zinc-50"
                : "border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-50"
            }`}
          >
            <span>套用後總天數</span>
            <span>{isOverLimit ? maxDays : newTotal} 天</span>
          </div>
          {isOverLimit && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5">
              原行程將移除 {newTotal - maxDays!} 天以符合回程日期
            </p>
          )}
        </div>

        <button
          onClick={onApply}
          disabled={isApplying || items.length === 0}
          className="w-full mt-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
        >
          {isApplying ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              AI 正在規劃行程…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              一次套用至行程
            </>
          )}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { SortableStop } from "@/components/SortableStop";
import { StopDragPreview } from "@/components/StopDragPreview";
import { formatDuration } from "@/types/itinerary";
import type { Itinerary, Stop, DayMeals } from "@/types/itinerary";

const TIME_OF_DAY_LABELS: Record<string, string> = {
  morning: "早上",
  afternoon: "下午",
  evening: "晚上",
};

interface EditableItineraryCardProps {
  data: {
    success: boolean;
    id: string;
    data: Itinerary;
  };
  onUpdate?: () => void;
}

type EditingStop = {
  id: string;
  name: string;
  description: string;
  duration_minutes: number;
};

export default function EditableItineraryCard({
  data,
  onUpdate,
}: EditableItineraryCardProps) {
  const [itinerary, setItinerary] = useState(data.data);
  const [editingStop, setEditingStop] = useState<EditingStop | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [exchangeRate, setExchangeRate] = useState(35);
  const [collapsedDays, setCollapsedDays] = useState<Set<number>>(new Set());

  const toggleDayCollapse = (dayNum: number) =>
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      next.has(dayNum) ? next.delete(dayNum) : next.add(dayNum);
      return next;
    });

  const allCollapsed = itinerary.days.length > 0 && itinerary.days.every((d) => collapsedDays.has(d.day));

  const toggleAll = () =>
    setCollapsedDays(allCollapsed ? new Set() : new Set(itinerary.days.map((d) => d.day)));

  const scrollToDay = (dayNum: number) =>
    document.getElementById(`day-card-${dayNum}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [recalculatingDay, setRecalculatingDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [snapshotBeforeDrag, setSnapshotBeforeDrag] =
    useState<Itinerary | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor)
  );

  const calculateDayDuration = (stops: Stop[]) =>
    stops.reduce((total, s) => total + (s.duration_minutes || 0), 0);

  const calculateDayCost = (stops: Stop[]) =>
    stops.reduce((total, s) => total + (s.estimated_cost ?? 0), 0);

  const calculateMealCost = (meals?: DayMeals) =>
    (meals?.breakfast?.estimated_cost ?? 0) +
    (meals?.lunch?.estimated_cost ?? 0) +
    (meals?.dinner?.estimated_cost ?? 0);

  const hasCostData = (stops: Stop[]) =>
    stops.some((s) => s.estimated_cost !== undefined);

  const formatCost = (amount: number, currency?: string) =>
    `${currency ?? ""} ${amount.toLocaleString()}`.trim();

  const buildGoogleMapsUrl = (stops: Stop[]) => {
    const waypoints = stops.map((s) => encodeURIComponent(s.name)).join("/");
    return `https://www.google.com/maps/dir/${waypoints}`;
  };

  const findStopById = useCallback(
    (id: string): Stop | undefined => {
      for (const day of itinerary.days) {
        const stop = day.stops.find((s) => s.id === id);
        if (stop) return stop;
      }
      return undefined;
    },
    [itinerary]
  );

  const findDayIndexByStopId = useCallback(
    (stopId: string): number =>
      itinerary.days.findIndex((day) =>
        day.stops.some((s) => s.id === stopId)
      ),
    [itinerary]
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    setSnapshotBeforeDrag(structuredClone(itinerary));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeStopId = active.id as string;
    const overStopId = over.id as string;
    const activeDayIndex = findDayIndexByStopId(activeStopId);
    const overDayIndex = findDayIndexByStopId(overStopId);

    if (activeDayIndex === -1 || overDayIndex === -1) return;
    if (activeDayIndex === overDayIndex) return;
    if (itinerary.days[activeDayIndex].stops.length <= 1) return;

    setItinerary((prev) => {
      const newDays = prev.days.map((d) => ({ ...d, stops: [...d.stops] }));
      const sourceStops = newDays[activeDayIndex].stops;
      const targetStops = newDays[overDayIndex].stops;
      const stopIndex = sourceStops.findIndex((s) => s.id === activeStopId);
      if (stopIndex === -1) return prev;

      const [movedStop] = sourceStops.splice(stopIndex, 1);
      const overIndex = targetStops.findIndex((s) => s.id === overStopId);
      targetStops.splice(
        overIndex >= 0 ? overIndex : targetStops.length,
        0,
        movedStop
      );
      return { ...prev, days: newDays };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) {
      setSnapshotBeforeDrag(null);
      return;
    }

    const activeDayIndex = findDayIndexByStopId(active.id as string);
    const overDayIndex = findDayIndexByStopId(over.id as string);

    if (activeDayIndex === -1 || overDayIndex === -1) {
      setSnapshotBeforeDrag(null);
      return;
    }

    if (activeDayIndex === overDayIndex) {
      const day = itinerary.days[activeDayIndex];
      const oldIndex = day.stops.findIndex((s) => s.id === active.id);
      const newIndex = day.stops.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) {
        setSnapshotBeforeDrag(null);
        return;
      }
      const newDays = [...itinerary.days];
      newDays[activeDayIndex] = {
        ...day,
        stops: arrayMove(day.stops, oldIndex, newIndex).map((stop) => ({
          ...stop,
          transport_from_prev: undefined,
          time_of_day: undefined,
        })),
      };
      const newItinerary = { ...itinerary, days: newDays };
      setItinerary(newItinerary);
      persistReorder(newItinerary, itinerary.days[activeDayIndex].id ?? undefined);
      return;
    }

    persistReorder(itinerary);
  }

  async function persistReorder(target: Itinerary, sameDayId?: string) {
    try {
      const affectedDays = target.days
        .filter((day) => day.id)
        .map((day) => ({
          dayId: day.id!,
          stopIds: day.stops.map((s) => s.id!).filter(Boolean),
        }));

      const res = await fetch("/api/v1/stops/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itineraryId: data.id, days: affectedDays }),
      });

      if (!res.ok) throw new Error("排序失敗");

      setSnapshotBeforeDrag(null);

      if (sameDayId) {
        // delay onUpdate until recalculation is done — otherwise fetchData overwrites the cleared state
        recalculateTransport(sameDayId, onUpdate);
      } else {
        onUpdate?.();
      }
    } catch (err) {
      if (snapshotBeforeDrag) {
        setItinerary(snapshotBeforeDrag);
        setSnapshotBeforeDrag(null);
      }
      setError(err instanceof Error ? err.message : "排序失敗");
      setTimeout(() => setError(null), 3000);
    }
  }

  async function recalculateTransport(dayId: string, afterDone?: () => void) {
    setRecalculatingDay(dayId);
    try {
      const res = await fetch(`/api/v1/days/${dayId}/recalculate-transport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itineraryId: data.id }),
      });

      if (!res.ok) throw new Error("交通重算失敗");

      const { stops: updatedFields } = await res.json() as {
        stops: { id: string; transport_from_prev: string; time_of_day: "morning" | "afternoon" | "evening" }[];
      };
      const fieldMap = new Map(updatedFields.map((s) => [s.id, s]));

      setItinerary((prev) => ({
        ...prev,
        days: prev.days.map((day) =>
          day.id !== dayId
            ? day
            : {
                ...day,
                stops: day.stops.map((stop) => {
                  const updated = stop.id ? fieldMap.get(stop.id) : undefined;
                  return updated
                    ? { ...stop, transport_from_prev: updated.transport_from_prev, time_of_day: updated.time_of_day }
                    : stop;
                }),
              }
        ),
      }));
    } catch {
      // silently ignore — reorder already succeeded; transport stays stale but structurally correct
    } finally {
      setRecalculatingDay(null);
      afterDone?.();
    }
  }

  const handleDelete = async (stopId: string, dayIndex: number) => {
    if (!stopId) return;

    const day = itinerary.days[dayIndex];
    if (day.stops.length <= 1) {
      setError("每天至少需要一個景點");
      setTimeout(() => setError(null), 3000);
      return;
    }

    if (!confirm("確定要刪除這個景點嗎？")) return;

    setLoading(stopId);
    setError(null);

    try {
      const res = await fetch(`/api/v1/stops/${stopId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itineraryId: data.id }),
      });

      if (!res.ok) {
        const resData = await res.json();
        throw new Error(resData.error || "刪除失敗");
      }

      setItinerary((prev) => ({
        ...prev,
        days: prev.days.map((d, idx) =>
          idx === dayIndex
            ? { ...d, stops: d.stops.filter((s) => s.id !== stopId) }
            : d
        ),
      }));

      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除失敗");
    } finally {
      setLoading(null);
    }
  };

  const handleRegenerate = async (stopId: string) => {
    setRegenerating(stopId);
    setError(null);

    try {
      const res = await fetch(`/api/v1/stops/${stopId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itineraryId: data.id }),
      });

      if (!res.ok) {
        const resData = await res.json();
        throw new Error(resData.error || "重新生成失敗");
      }

      const newStop = await res.json();

      setItinerary((prev) => ({
        ...prev,
        days: prev.days.map((d) => ({
          ...d,
          stops: d.stops.map((s) =>
            s.id === stopId
              ? {
                  ...s,
                  name: newStop.name,
                  description: newStop.description,
                  duration_minutes: newStop.duration_minutes,
                }
              : s
          ),
        })),
      }));

      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重新生成失敗");
    } finally {
      setRegenerating(null);
    }
  };

  const handleEdit = (stop: Stop) => {
    if (!stop.id) return;
    setEditingStop({
      id: stop.id,
      name: stop.name,
      description: stop.description,
      duration_minutes: stop.duration_minutes,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingStop) return;
    setLoading(editingStop.id);
    setError(null);

    try {
      const res = await fetch(`/api/v1/stops/${editingStop.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingStop.name,
          description: editingStop.description,
          duration_minutes: editingStop.duration_minutes,
          itineraryId: data.id,
        }),
      });

      if (!res.ok) {
        const resData = await res.json();
        throw new Error(resData.error || "更新失敗");
      }

      setItinerary((prev) => ({
        ...prev,
        days: prev.days.map((d) => ({
          ...d,
          stops: d.stops.map((s) =>
            s.id === editingStop.id
              ? {
                  ...s,
                  name: editingStop.name,
                  description: editingStop.description,
                  duration_minutes: editingStop.duration_minutes,
                }
              : s
          ),
        })),
      }));

      setEditingStop(null);
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失敗");
    } finally {
      setLoading(null);
    }
  };

  const activeStop = activeId ? findStopById(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="text-center">
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {itinerary.title}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            共 {itinerary.days.length} 天行程・可拖曳排序景點
          </p>
        </div>

        <div className="sticky top-2 z-20 flex items-center gap-2 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/90 dark:bg-zinc-900/90 backdrop-blur px-3 py-2 shadow-sm">
          <button
            onClick={toggleAll}
            className="shrink-0 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          >
            {allCollapsed ? "展開全部" : "折疊全部"}
          </button>
          <div className="w-px h-4 shrink-0 bg-zinc-200 dark:bg-zinc-700" />
          {itinerary.days.map((day) => (
            <button
              key={day.day}
              onClick={() => scrollToDay(day.day)}
              className="shrink-0 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              Day {day.day}
            </button>
          ))}
        </div>

        {(() => {
          const anyHasCost = itinerary.days.some((d) => hasCostData(d.stops));
          if (!anyHasCost) return null;
          const grandTotal = itinerary.days.reduce(
            (sum, d) => sum + calculateDayCost(d.stops) + calculateMealCost(d.meals),
            0
          );
          const cur = itinerary.currency ?? "EUR";
          return (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-4 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">財務總覽</h3>
                <div className="flex items-center gap-2 text-sm text-white/90">
                  <span>{cur} 1 =</span>
                  <input
                    type="number"
                    value={exchangeRate}
                    onChange={(e) =>
                      setExchangeRate(Math.max(1, Number(e.target.value) || 1))
                    }
                    className="w-20 px-2 py-0.5 rounded border border-white/30 bg-white/20 text-white placeholder-white/60 text-sm text-center focus:outline-none focus:ring-2 focus:ring-white/50"
                    min="1"
                  />
                  <span>TWD</span>
                </div>
              </div>
              <div className="p-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      <th className="text-left pb-2 text-zinc-500 dark:text-zinc-400 font-medium">
                        天數
                      </th>
                      <th className="text-right pb-2 text-zinc-500 dark:text-zinc-400 font-medium">
                        預估花費 ({cur})
                      </th>
                      <th className="text-right pb-2 text-zinc-500 dark:text-zinc-400 font-medium">
                        折合台幣 (TWD)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {itinerary.days.map((day) => {
                      const cost = calculateDayCost(day.stops) + calculateMealCost(day.meals);
                      const ntd = Math.round(cost * exchangeRate);
                      return (
                        <tr
                          key={day.id || day.day}
                          className="border-b border-zinc-50 dark:border-zinc-800/50"
                        >
                          <td className="py-2 text-zinc-700 dark:text-zinc-300">
                            第 {day.day} 天{day.theme ? `・${day.theme}` : ""}
                          </td>
                          <td className="py-2 text-right text-zinc-700 dark:text-zinc-300">
                            {cost.toLocaleString()}
                          </td>
                          <td className="py-2 text-right text-zinc-700 dark:text-zinc-300">
                            {ntd.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-zinc-200 dark:border-zinc-700">
                      <td className="pt-2.5 font-bold text-zinc-900 dark:text-zinc-50">
                        合計
                      </td>
                      <td className="pt-2.5 text-right font-bold text-zinc-900 dark:text-zinc-50">
                        {grandTotal.toLocaleString()}
                      </td>
                      <td className="pt-2.5 text-right font-bold text-emerald-600 dark:text-emerald-400">
                        {Math.round(grandTotal * exchangeRate).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
                  * 花費為 AI 預估值，實際費用可能有所差異。請於出發前確認最新匯率。
                </p>
              </div>
            </div>
          );
        })()}

        {itinerary.days.map((day, dayIndex) => {
          const totalDuration = calculateDayDuration(day.stops);
          const dayCost = calculateDayCost(day.stops);
          const showCost = hasCostData(day.stops);
          const stopIds = day.stops.map((s) => s.id!).filter(Boolean);

          const isCollapsed = collapsedDays.has(day.day);

          return (
            <div
              key={day.id || day.day}
              id={`day-card-${day.day}`}
              className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden"
            >
              <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-5 py-4">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => toggleDayCollapse(day.day)}
                    className="flex items-center gap-2 text-left"
                  >
                    <svg
                      className={`w-4 h-4 text-white/80 shrink-0 transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    <div className="text-lg font-bold text-white">
                      第 {day.day} 天
                      {day.theme && (
                        <span className="text-sm font-normal ml-2 opacity-90">
                          · {day.theme}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-3">
                    {recalculatingDay === day.id && (
                      <div className="flex items-center gap-1.5 text-sm text-white opacity-80">
                        <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        更新交通中…
                      </div>
                    )}
                    {recalculatingDay !== day.id && totalDuration > 0 && (
                      <div className="text-sm text-white opacity-90">
                        總時長：{formatDuration(totalDuration)}
                      </div>
                    )}
                    {recalculatingDay !== day.id && showCost && (
                      <div className="text-sm text-white opacity-90">
                        預估花費：{formatCost(dayCost, itinerary.currency)}
                      </div>
                    )}
                    <a
                      href={buildGoogleMapsUrl(day.stops)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded-md bg-white/20 hover:bg-white/30 transition-colors px-2.5 py-1 text-xs font-medium text-white"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
                        <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .976.544l.062.029.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd" />
                      </svg>
                      導航
                    </a>
                  </div>
                </div>
                {day.accommodation && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-white/80">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-3.5 shrink-0">
                      <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                      <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" />
                    </svg>
                    住宿建議：{day.accommodation.name}・{day.accommodation.area}
                  </div>
                )}
              </div>

              {!isCollapsed && (
                <div className="p-5">
                  <SortableContext
                    items={stopIds}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-0">
                      {(() => {
                        let lastTimeOfDay: string | undefined = undefined;
                        return day.stops.map((stop, idx) => {
                          const showTimeHeader =
                            stop.time_of_day !== undefined &&
                            stop.time_of_day !== lastTimeOfDay;
                          if (stop.time_of_day) lastTimeOfDay = stop.time_of_day;

                          return (
                            <div key={stop.id || idx}>
                              {showTimeHeader && (
                                <div className="flex items-center gap-2 py-2 mb-1">
                                  <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                                    {TIME_OF_DAY_LABELS[stop.time_of_day!]}
                                  </span>
                                  <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800" />
                                </div>
                              )}
                              {stop.transport_from_prev && (
                                <div className="flex items-center gap-2 py-1.5 pl-1 mb-1">
                                  <svg className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                  </svg>
                                  <span className="text-xs text-zinc-400 dark:text-zinc-500">
                                    {stop.transport_from_prev}
                                  </span>
                                </div>
                              )}
                              <SortableStop
                                stop={stop}
                                index={idx}
                                dayIndex={dayIndex}
                                currency={itinerary.currency}
                                editingStop={editingStop}
                                isLoading={loading === stop.id}
                                isRegenerating={regenerating === stop.id}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                                onRegenerate={handleRegenerate}
                                onSaveEdit={handleSaveEdit}
                                onCancelEdit={() => setEditingStop(null)}
                                onEditChange={setEditingStop}
                              />
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </SortableContext>
                </div>
              )}

              {!isCollapsed && day.meals && (
                <div className="px-5 pb-5">
                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                    <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3">
                      餐廳推薦
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { key: "breakfast", label: "早餐", icon: "🌅" },
                          { key: "lunch",     label: "午餐", icon: "☀️" },
                          { key: "dinner",    label: "晚餐", icon: "🌙" },
                        ] as const
                      ).map(({ key, label, icon }) => {
                        const meal = day.meals?.[key];
                        if (!meal) return null;
                        return (
                          <div
                            key={key}
                            className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/50 p-3"
                          >
                            <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">
                              {icon} {label}
                            </p>
                            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 leading-snug">
                              {meal.name}
                            </p>
                            {meal.description && (
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
                                {meal.description}
                              </p>
                            )}
                            {meal.estimated_cost !== undefined && (
                              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                                💶 {[itinerary.currency, meal.estimated_cost.toLocaleString()].filter(Boolean).join(" ")}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <DragOverlay>
        {activeStop ? <StopDragPreview stop={activeStop} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

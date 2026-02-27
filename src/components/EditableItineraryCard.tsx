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
import type { Itinerary, Stop } from "@/types/itinerary";

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
      setItinerary((prev) => {
        const day = prev.days[activeDayIndex];
        const oldIndex = day.stops.findIndex((s) => s.id === active.id);
        const newIndex = day.stops.findIndex((s) => s.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const newDays = [...prev.days];
        newDays[activeDayIndex] = {
          ...day,
          stops: arrayMove(day.stops, oldIndex, newIndex),
        };
        return { ...prev, days: newDays };
      });
    }

    persistReorder();
  }

  async function persistReorder() {
    try {
      const affectedDays = itinerary.days
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
      onUpdate?.();
    } catch (err) {
      if (snapshotBeforeDrag) {
        setItinerary(snapshotBeforeDrag);
        setSnapshotBeforeDrag(null);
      }
      setError(err instanceof Error ? err.message : "排序失敗");
      setTimeout(() => setError(null), 3000);
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

        {itinerary.days.map((day, dayIndex) => {
          const totalDuration = calculateDayDuration(day.stops);
          const stopIds = day.stops.map((s) => s.id!).filter(Boolean);

          return (
            <div
              key={day.id || day.day}
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
                {totalDuration > 0 && (
                  <div className="text-sm text-white opacity-90">
                    總時長：{formatDuration(totalDuration)}
                  </div>
                )}
              </div>

              <div className="p-5">
                <SortableContext
                  items={stopIds}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-0">
                    {day.stops.map((stop, idx) => (
                      <SortableStop
                        key={stop.id || idx}
                        stop={stop}
                        index={idx}
                        dayIndex={dayIndex}
                        editingStop={editingStop}
                        isLoading={loading === stop.id}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                        onSaveEdit={handleSaveEdit}
                        onCancelEdit={() => setEditingStop(null)}
                        onEditChange={setEditingStop}
                      />
                    ))}
                  </div>
                </SortableContext>
              </div>
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

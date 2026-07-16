"use client";

import { useState, useCallback, useEffect, useMemo, Fragment } from "react";
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
import { DayBulkEditPanel } from "@/components/DayBulkEditPanel";
import { AccommodationPicker } from "@/components/AccommodationPicker";
import { MealPicker } from "@/components/MealPicker";
import { haversineKm } from "@/lib/distanceMatrix";
import { formatDuration } from "@/types/itinerary";
import type { Itinerary, Stop, DayMeals, Meal, MealType, Accommodation, StopCandidate } from "@/types/itinerary";

// A candidate from another day counts as "same city" if it's within this
// distance of the edited day's own stop centroid — used to build the reuse
// pool in the day bulk-edit panel (see reusableStops below).
const SAME_CITY_KM = 60;

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
  onExploreBorder?: () => void;
  hideCostSummary?: boolean;
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
  onExploreBorder,
  hideCostSummary = false,
}: EditableItineraryCardProps) {
  const [itinerary, setItinerary] = useState(data.data);
  const [editingStop, setEditingStop] = useState<EditingStop | null>(null);

  useEffect(() => {
    setItinerary(data.data);
  }, [data.data]);
  const [loading, setLoading] = useState<string | null>(null);
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
  const [removingWaypoint, setRemovingWaypoint] = useState<string | null>(null);
  const [recalculatingDay, setRecalculatingDay] = useState<string | null>(null);
  const [pickingAccommodationDayId, setPickingAccommodationDayId] = useState<string | null>(null);
  const [pickingMeal, setPickingMeal] = useState<{ dayId: string; mealType: MealType } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingToDay, setAddingToDay] = useState<string | null>(null);
  const [newStopName, setNewStopName] = useState("");
  const [addingStop, setAddingStop] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [snapshotBeforeDrag, setSnapshotBeforeDrag] =
    useState<Itinerary | null>(null);
  const [enrichWarning, setEnrichWarning] = useState<string | null>(null);

  const [bulkEditDayId, setBulkEditDayId] = useState<string | null>(null);
  const [bulkPhase, setBulkPhase] = useState<"select" | "suggest">("select");
  const [bulkKeepIds, setBulkKeepIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const duplicateStopInfo = useMemo(() => {
    const firstSeenDay = new Map<string, number>();
    const result = new Map<string, { originDay: number; name: string }>();
    for (const day of itinerary.days) {
      for (const stop of day.stops) {
        const norm = stop.name?.trim().toLowerCase();
        if (!stop.id || !norm) continue;
        const seenAt = firstSeenDay.get(norm);
        if (seenAt === undefined) {
          firstSeenDay.set(norm, day.day);
        } else if (seenAt !== day.day) {
          result.set(stop.id, { originDay: seenAt, name: stop.name });
        }
      }
    }
    return result;
  }, [itinerary.days]);

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

  const buildGoogleMapsUrl = (stops: Stop[], origin?: string) => {
    const points = [origin, ...stops.map((s) => s.name)].filter((p): p is string => !!p);
    const waypoints = points.map((p) => encodeURIComponent(p)).join("/");
    return `https://www.google.com/maps/dir/${waypoints}`;
  };

  // The previous day's accommodation is where the user actually starts this
  // day from (they slept there) — prefer its address over the day's own stops
  // so "導航" doesn't default to "current location".
  const overnightOrigin = (accommodation?: Accommodation | null) =>
    accommodation && accommodation.name !== "無需住宿"
      ? accommodation.address || accommodation.name || accommodation.area
      : undefined;

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

  const handleStartBulkEdit = (dayId: string, stops: Stop[]) => {
    setBulkEditDayId(dayId);
    setBulkPhase("select");
    setBulkKeepIds(new Set(stops.map((s) => s.id!).filter(Boolean)));
    setBulkError(null);
  };

  const handleToggleBulkKeep = (stopId: string) => {
    setBulkKeepIds((prev) => {
      const next = new Set(prev);
      next.has(stopId) ? next.delete(stopId) : next.add(stopId);
      return next;
    });
  };

  const handleCancelBulkEdit = () => {
    setBulkEditDayId(null);
    setBulkPhase("select");
    setBulkKeepIds(new Set());
    setBulkError(null);
  };

  const handleApplyBulkDelete = async (dayId: string) => {
    const day = itinerary.days.find((d) => d.id === dayId);
    if (!day) return;

    const toDelete = day.stops.map((s) => s.id!).filter((id) => id && !bulkKeepIds.has(id));

    setBulkBusy(true);
    setBulkError(null);

    try {
      // Sequential, not Promise.all: DELETE does a read-modify-write of the
      // whole itinerary.days blob with no optimistic locking — concurrent
      // calls would race and lose updates.
      for (const stopId of toDelete) {
        const res = await fetch(`/api/v1/stops/${stopId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itineraryId: data.id }),
        });
        if (!res.ok) {
          const resData = await res.json();
          throw new Error(resData.error || "刪除失敗");
        }
      }

      if (toDelete.length > 0) {
        setItinerary((prev) => ({
          ...prev,
          days: prev.days.map((d) =>
            d.id === dayId ? { ...d, stops: d.stops.filter((s) => !toDelete.includes(s.id!)) } : d
          ),
        }));
      }

      setBulkPhase("suggest");
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "刪除失敗");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleFinishBulkEdit = (dayId: string) => {
    handleCancelBulkEdit();
    recalculateTransport(dayId, onUpdate);
  };

  const handleConfirmBulkAdd = async (dayId: string, stops: StopCandidate[]) => {
    const res = await fetch(`/api/v1/days/${dayId}/stops`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itineraryId: data.id, stops }),
    });

    if (!res.ok) {
      const resData = await res.json();
      setBulkError(resData.error || "新增失敗");
      return;
    }

    const { stops: newStops } = await res.json();

    setItinerary((prev) => ({
      ...prev,
      days: prev.days.map((d) => (d.id === dayId ? { ...d, stops: [...d.stops, ...newStops] } : d)),
    }));

    handleFinishBulkEdit(dayId);
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

  const updateDayAccommodation = (dayId: string, accommodation: Accommodation) => {
    setItinerary((prev) => ({
      ...prev,
      days: prev.days.map((d) =>
        d.id === dayId ? { ...d, accommodation } : d
      ),
    }));
  };

  const updateDayMeal = (dayId: string, mealType: MealType, meal: Meal) => {
    setItinerary((prev) => ({
      ...prev,
      days: prev.days.map((d) =>
        d.id === dayId ? { ...d, meals: { ...d.meals, [mealType]: meal } } : d
      ),
    }));
  };

  useEffect(() => {
    async function enrichAll() {
      for (const day of itinerary.days) {
        if (!day.id || !day.accommodation || day.accommodation.placeId) continue;
        try {
          const res = await fetch(`/api/v1/days/${day.id}/accommodation/enrich`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itineraryId: data.id }),
          });
          if (res.ok) {
            const result = await res.json();
            updateDayAccommodation(day.id, result.accommodation as Accommodation);
          }
        } catch {
          // silently skip failed enrich
        }
      }
    }
    enrichAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    async function enrichAllStops() {
      try {
        const res = await fetch(`/api/v1/itinerary/${data.id}/enrich-all-stops`, { method: "POST" });
        if (!res.ok) return;
        const result = await res.json();
        const refresh = await fetch(`/api/v1/itinerary/${data.id}`);
        if (refresh.ok) {
          const refreshed = await refresh.json();
          setItinerary(refreshed.data);
        }
        if (result.suspicious > 0) {
          const names = (result.suspiciousStops as { name: string; day: number }[])
            .map((s) => `第 ${s.day} 天・${s.name}`)
            .join("、");
          setEnrichWarning(`${result.suspicious} 個景點地點可能有誤，請點 ↗ 驗證：${names}`);
        }
      } catch {
        // silently skip failed enrich
      }
    }
    enrichAllStops();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRemoveWaypoint = async (transitTo: string) => {
    if (!confirm(`確定要移除「${transitTo}」的移動日與所有停留天嗎？此操作無法復原。`)) return;
    setRemovingWaypoint(transitTo);
    setError(null);
    try {
      const res = await fetch(`/api/v1/itinerary/${data.id}/remove-waypoint`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transitTo }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "移除失敗");
      }
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除失敗");
      setTimeout(() => setError(null), 6000);
    } finally {
      setRemovingWaypoint(null);
    }
  };

  const handleAddStop = async (dayId: string) => {
    if (!newStopName.trim()) return;
    setAddingStop(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/days/${dayId}/stops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itineraryId: data.id, stopName: newStopName.trim() }),
      });
      if (!res.ok) {
        const resData = await res.json();
        throw new Error(resData.error || "新增失敗");
      }
      const { stop: newStop } = await res.json();
      setItinerary((prev) => ({
        ...prev,
        days: prev.days.map((d) =>
          d.id === dayId ? { ...d, stops: [...d.stops, newStop] } : d
        ),
      }));
      setNewStopName("");
      setAddingToDay(null);
      recalculateTransport(dayId, onUpdate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增景點失敗");
    } finally {
      setAddingStop(false);
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
        {enrichWarning && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <span className="flex-1">{enrichWarning}</span>
            <button onClick={() => setEnrichWarning(null)} className="shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-200">✕</button>
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

        {!hideCostSummary && (() => {
          const anyHasCost = itinerary.days.some((d) => hasCostData(d.stops));
          if (!anyHasCost) return null;
          const grandTotal = itinerary.days.reduce(
            (sum, d) => sum + calculateDayCost(d.stops) + calculateMealCost(d.meals) + (d.accommodation?.estimated_cost ?? 0),
            0
          );
          const cur = itinerary.currency ?? "USD";
          return (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-4">
                <h3 className="text-lg font-bold text-white">財務總覽</h3>
              </div>
              <div className="p-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 dark:border-zinc-800">
                      <th className="text-left pb-2 text-zinc-500 dark:text-zinc-400 font-medium">天數</th>
                      <th className="text-right pb-2 text-zinc-500 dark:text-zinc-400 font-medium">({cur})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itinerary.days.map((day) => {
                      const cost =
                        calculateDayCost(day.stops) +
                        calculateMealCost(day.meals) +
                        (day.accommodation?.estimated_cost ?? 0);
                      return (
                        <tr key={day.id || day.day} className="border-b border-zinc-50 dark:border-zinc-800/50">
                          <td className="py-2 text-zinc-700 dark:text-zinc-300">第 {day.day} 天</td>
                          <td className="py-2 text-right text-zinc-700 dark:text-zinc-300">{cost.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-zinc-200 dark:border-zinc-700">
                      <td className="pt-2.5 font-bold text-zinc-900 dark:text-zinc-50">合計</td>
                      <td className="pt-2.5 text-right font-bold text-zinc-900 dark:text-zinc-50">{grandTotal.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        })()}

        {itinerary.days.map((day, dayIndex) => {
          const prevDay = dayIndex > 0 ? itinerary.days[dayIndex - 1] : null;
          const totalDuration = calculateDayDuration(day.stops);
          const dayCost = calculateDayCost(day.stops);
          const showCost = hasCostData(day.stops);
          const stopIds = day.stops.map((s) => s.id!).filter(Boolean);

          const dayStopsWithGeo = day.stops.filter(
            (s): s is Stop & { lat: number; lng: number } =>
              typeof s.lat === "number" && typeof s.lng === "number"
          );
          const dayCentroid =
            dayStopsWithGeo.length > 0
              ? {
                  lat: dayStopsWithGeo.reduce((sum, s) => sum + s.lat, 0) / dayStopsWithGeo.length,
                  lng: dayStopsWithGeo.reduce((sum, s) => sum + s.lng, 0) / dayStopsWithGeo.length,
                }
              : null;

          const isCollapsed = collapsedDays.has(day.day);
          const isTransitDay = day.isTransitDay === true;

          // Cross-border connector appears before each transit day (when prev day is non-transit)
          const showCrossBorderConnector = isTransitDay && prevDay && !prevDay.isTransitDay;
          // Location banner appears before the first non-transit day after a transit day
          const showLocationBanner = !isTransitDay && prevDay?.isTransitDay && prevDay.transitTo;

          return (
            <Fragment key={day.id || day.day}>
              {showCrossBorderConnector && (
                <div className="relative py-4">
                  <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-violet-200 to-transparent dark:via-violet-800/50" />
                  <div className="relative flex items-center justify-center">
                    <div className="flex items-center gap-3 rounded-full border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-950/20 px-4 py-2 shadow-sm">
                      <svg className="w-4 h-4 text-violet-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                      </svg>
                      <span className="text-sm font-medium text-violet-700 dark:text-violet-300">
                        跨國銜接{day.transitTo ? `：前往 ${day.transitTo}` : ""}
                      </span>
                      {onExploreBorder && (
                        <>
                          <span className="text-violet-300 dark:text-violet-700">·</span>
                          <button
                            type="button"
                            onClick={onExploreBorder}
                            className="text-sm font-semibold text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-200 transition-colors"
                          >
                            探索更多邊境城市 →
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {showLocationBanner && (
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800" />
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider px-2">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                    </svg>
                    {prevDay!.transitTo}
                  </div>
                  <div className="flex-1 h-px bg-zinc-100 dark:bg-zinc-800" />
                </div>
              )}

            <div
              id={`day-card-${day.day}`}
              className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden"
            >
              <div
                className={`px-5 py-4 bg-gradient-to-r ${
                  isTransitDay
                    ? "from-amber-500 to-orange-500"
                    : "from-blue-500 to-blue-600"
                }`}
              >
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
                    <div className="text-lg font-bold text-white flex items-center gap-2">
                      第 {day.day} 天
                      {isTransitDay && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold bg-white/25 px-2 py-0.5 rounded-full">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                          </svg>
                          跨國移動日
                        </span>
                      )}
                      {day.theme && (
                        <span className="text-sm font-normal opacity-90">
                          · {day.theme}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-3">
                    {isTransitDay ? (
                      day.transitTo && (
                        <div className="flex items-center gap-2">
                          <div className="text-sm text-white/90 flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            前往 {day.transitTo}
                          </div>
                          <button
                            onClick={() => handleRemoveWaypoint(day.transitTo!)}
                            disabled={removingWaypoint === day.transitTo}
                            className="flex items-center gap-1 rounded-md bg-white/20 hover:bg-red-500/60 disabled:opacity-50 transition-colors px-2 py-1 text-xs font-medium text-white"
                            title="移除此城市段落"
                          >
                            {removingWaypoint === day.transitTo ? (
                              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            )}
                            移除
                          </button>
                        </div>
                      )
                    ) : (
                      <>
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
                        <button
                          onClick={() => day.id && recalculateTransport(day.id, onUpdate)}
                          disabled={recalculatingDay !== null || !day.id}
                          className="flex items-center gap-1 rounded-md bg-white/20 hover:bg-white/30 disabled:opacity-30 transition-colors px-2.5 py-1 text-xs font-medium text-white"
                          title="重新計算本日交通方式與時間"
                        >
                          <svg
                            className={`w-3.5 h-3.5 ${recalculatingDay === day.id ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          重算交通
                        </button>
                        <a
                          href={buildGoogleMapsUrl(day.stops, overnightOrigin(prevDay?.accommodation))}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 rounded-md bg-white/20 hover:bg-white/30 transition-colors px-2.5 py-1 text-xs font-medium text-white"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-3.5">
                            <path fillRule="evenodd" d="M9.69 18.933l.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .976.544l.062.029.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd" />
                          </svg>
                          導航
                        </a>
                        <button
                          onClick={() =>
                            bulkEditDayId === day.id
                              ? handleCancelBulkEdit()
                              : day.id && handleStartBulkEdit(day.id, day.stops)
                          }
                          disabled={bulkEditDayId !== null && bulkEditDayId !== day.id}
                          className="flex items-center gap-1 rounded-md bg-white/20 hover:bg-white/30 disabled:opacity-30 transition-colors px-2.5 py-1 text-xs font-medium text-white"
                        >
                          {bulkEditDayId === day.id ? "取消編輯" : "編輯本日"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {day.accommodation && day.accommodation.name !== "無需住宿" && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-white/80">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-3.5 shrink-0">
                      <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                      <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" />
                    </svg>
                    住宿建議：{day.accommodation.name || day.accommodation.area}{day.accommodation.name && day.accommodation.area && day.accommodation.area !== day.accommodation.name ? `・${day.accommodation.area}` : ""}
                  </div>
                )}
              </div>

              {!isCollapsed && isTransitDay && day.stops.length === 0 && (
                <div className="px-5 py-4 text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  移動日，無景點安排。抵達後可自行新增行程。
                </div>
              )}

              {!isCollapsed && isTransitDay && day.stops.length > 0 && (
                <div className="p-5">
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
                            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40 p-3 mb-2">
                              <div className="flex items-start gap-3">
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm leading-snug">
                                    {stop.name}
                                  </p>
                                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
                                    {stop.description}
                                  </p>
                                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                    {stop.duration_minutes > 0 && (
                                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                                        {formatDuration(stop.duration_minutes)}
                                      </span>
                                    )}
                                    {stop.estimated_cost != null && stop.estimated_cost > 0 && (
                                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                        {[itinerary.currency, stop.estimated_cost.toLocaleString()].filter(Boolean).join(" ")}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {!isCollapsed && !isTransitDay && (
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
                                bulkMode={bulkEditDayId === day.id}
                                selected={!!stop.id && bulkKeepIds.has(stop.id)}
                                onToggleSelect={handleToggleBulkKeep}
                                isDuplicate={!!stop.id && duplicateStopInfo.has(stop.id)}
                                duplicateReason={
                                  stop.id && duplicateStopInfo.has(stop.id)
                                    ? `與第 ${duplicateStopInfo.get(stop.id)!.originDay} 天的「${duplicateStopInfo.get(stop.id)!.name}」重複，建議進行編輯`
                                    : undefined
                                }
                                onEdit={handleEdit}
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

                  {bulkEditDayId === day.id && bulkPhase === "select" && day.id && (
                    <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
                      {bulkError && (
                        <p className="text-sm text-red-600 dark:text-red-400">{bulkError}</p>
                      )}
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        保留 {bulkKeepIds.size} 個、刪除{" "}
                        {day.stops.filter((s) => s.id && !bulkKeepIds.has(s.id)).length} 個
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApplyBulkDelete(day.id!)}
                          disabled={bulkBusy}
                          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                          {bulkBusy ? "處理中…" : "套用"}
                        </button>
                        <button
                          onClick={handleCancelBulkEdit}
                          disabled={bulkBusy}
                          className="px-4 py-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-sm rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}

                  {bulkEditDayId === day.id && bulkPhase === "suggest" && day.id && (
                    <DayBulkEditPanel
                      itineraryId={data.id}
                      dayId={day.id}
                      reusableStops={itinerary.days
                        .filter((d) => d.id !== day.id)
                        .flatMap((d) =>
                          d.stops
                            .filter((s) => {
                              // Prefer the stop's own coordinates over the day-level
                              // waypointCity tag — a transit day is tagged with its
                              // departure city even though some of its stops (e.g. the
                              // arrival city's attractions) are actually in the destination.
                              if (dayCentroid && typeof s.lat === "number" && typeof s.lng === "number") {
                                return haversineKm(s.lat, s.lng, dayCentroid.lat, dayCentroid.lng) <= SAME_CITY_KM;
                              }
                              // No coordinates to compare — only include when both
                              // days carry a waypointCity and they actually match;
                              // otherwise there's no basis for "same city" so exclude.
                              return !!day.waypointCity && d.waypointCity === day.waypointCity;
                            })
                            .map((s) => ({
                              dayNumber: d.day,
                              candidate: {
                                name: s.name,
                                description: s.description,
                                duration_minutes: s.duration_minutes,
                                placeId: s.placeId,
                                lat: s.lat,
                                lng: s.lng,
                                address: s.address,
                                rating: s.rating,
                              },
                            }))
                        )}
                      onCancel={() => handleFinishBulkEdit(day.id!)}
                      onConfirmAdd={(stops) => handleConfirmBulkAdd(day.id!, stops)}
                    />
                  )}

                  {/* Add stop */}
                  {day.id && bulkEditDayId !== day.id && (
                    <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                      {addingToDay === day.id ? (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            autoFocus
                            value={newStopName}
                            onChange={(e) => setNewStopName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddStop(day.id!);
                              if (e.key === "Escape") { setAddingToDay(null); setNewStopName(""); }
                            }}
                            placeholder="輸入景點名稱，例：環球影城"
                            disabled={addingStop}
                            className="flex-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                          />
                          <button
                            onClick={() => handleAddStop(day.id!)}
                            disabled={addingStop || !newStopName.trim()}
                            className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shrink-0"
                          >
                            {addingStop ? (
                              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                              </svg>
                            ) : "新增"}
                          </button>
                          <button
                            onClick={() => { setAddingToDay(null); setNewStopName(""); }}
                            disabled={addingStop}
                            className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 text-sm rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors shrink-0"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setAddingToDay(day.id!); setNewStopName(""); }}
                          disabled={!!editingStop || !!loading}
                          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-30 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          新增景點
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!isCollapsed && !isTransitDay && day.accommodation?.name !== "無需住宿" && (
                <div className="px-5 pb-5">
                  <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                        住宿推薦
                      </p>
                      {day.accommodation && day.id && pickingAccommodationDayId !== day.id && (
                        <button
                          onClick={() => setPickingAccommodationDayId(day.id!)}
                          className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
                          </svg>
                          換一間
                        </button>
                      )}
                    </div>

                    {day.accommodation ? (
                      <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm leading-snug">
                              {day.accommodation.name || day.accommodation.area}
                            </p>
                            {day.accommodation.name ? (
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                {day.accommodation.area}
                              </p>
                            ) : day.accommodation.reason ? (
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                {day.accommodation.reason}
                              </p>
                            ) : null}
                            {day.accommodation.address && (
                              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 leading-snug">
                                {day.accommodation.address}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1.5">
                              {day.accommodation.rating != null && (
                                <span className="text-xs text-amber-500 font-medium">
                                  ★ {day.accommodation.rating}
                                </span>
                              )}
                              {day.accommodation.priceLevel != null && day.accommodation.priceLevel > 0 && (
                                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                                  {"$".repeat(day.accommodation.priceLevel)}
                                </span>
                              )}
                              {day.accommodation.estimated_cost !== undefined && (
                                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                  💴{" "}
                                  {day.accommodation.estimated_cost_low !== undefined &&
                                  day.accommodation.estimated_cost_high !== undefined
                                    ? [
                                        itinerary.currency,
                                        `${day.accommodation.estimated_cost_low.toLocaleString()}-${day.accommodation.estimated_cost_high.toLocaleString()}`,
                                      ]
                                        .filter(Boolean)
                                        .join(" ")
                                    : [itinerary.currency, day.accommodation.estimated_cost.toLocaleString()]
                                        .filter(Boolean)
                                        .join(" ")}
                                  /晚
                                </span>
                              )}
                              {day.accommodation.nearestStation && (
                                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                                  距{day.accommodation.nearestStation.name}{" "}
                                  {day.accommodation.nearestStation.distanceMeters >= 1000
                                    ? `${(day.accommodation.nearestStation.distanceMeters / 1000).toFixed(1)}km`
                                    : `${day.accommodation.nearestStation.distanceMeters}m`}
                                </span>
                              )}
                            </div>
                          </div>
                          {day.accommodation.placeId && (
                            <a
                              href={`https://www.google.com/maps/place/?q=place_id:${day.accommodation.placeId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 rounded-md bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors"
                            >
                              在地圖上查看
                            </a>
                          )}
                        </div>
                      </div>
                    ) : pickingAccommodationDayId !== day.id ? (
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 p-3">
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                          準備預訂住宿了嗎？
                        </p>
                        <div className="flex items-center gap-3 flex-wrap">
                          <a
                            href={`https://www.google.com/maps/search/hotels+near+${encodeURIComponent(day.theme ?? "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 underline transition-colors"
                          >
                            搜尋附近飯店 →
                          </a>
                          {day.id && (
                            <button
                              onClick={() => setPickingAccommodationDayId(day.id!)}
                              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                            >
                              選擇住宿
                            </button>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {pickingAccommodationDayId === day.id && day.id && (
                      <AccommodationPicker
                        itineraryId={data.id}
                        dayId={day.id}
                        currency={itinerary.currency}
                        onCancel={() => setPickingAccommodationDayId(null)}
                        onSelected={(acc) => {
                          updateDayAccommodation(day.id!, acc);
                          setPickingAccommodationDayId(null);
                        }}
                      />
                    )}
                  </div>
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
                        const isPickingThis =
                          day.id != null && pickingMeal?.dayId === day.id && pickingMeal.mealType === key;
                        if (!meal) {
                          return (
                            <div
                              key={key}
                              className="rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-dashed border-zinc-200 dark:border-zinc-700 p-3 flex flex-col items-start justify-between"
                            >
                              <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500 mb-1">
                                {icon} {label}
                              </p>
                              {day.id && !isPickingThis && (
                                <button
                                  onClick={() => setPickingMeal({ dayId: day.id!, mealType: key })}
                                  className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                                >
                                  選擇{label}
                                </button>
                              )}
                            </div>
                          );
                        }
                        return (
                          <div
                            key={key}
                            className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/50 p-3"
                          >
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                                {icon} {label}
                              </p>
                              {day.id && !isPickingThis && (
                                <button
                                  onClick={() => setPickingMeal({ dayId: day.id!, mealType: key })}
                                  className="shrink-0 text-[11px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                                >
                                  換一家
                                </button>
                              )}
                            </div>
                            <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 leading-snug">
                              {meal.name}
                            </p>
                            {meal.description && (
                              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-snug">
                                {meal.description}
                              </p>
                            )}
                            {meal.address && (
                              <div className="flex items-center gap-1 mt-1">
                                <span className="text-[11px] text-zinc-400 dark:text-zinc-500 leading-tight line-clamp-1">
                                  {meal.address}
                                </span>
                                {meal.placeId && (
                                  <a
                                    href={`https://www.google.com/maps/place/?q=place_id:${meal.placeId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 text-[11px] text-blue-400 hover:text-blue-600 dark:text-blue-500 dark:hover:text-blue-300 transition-colors"
                                    title="在 Google Maps 上導航"
                                  >
                                    ↗
                                  </a>
                                )}
                              </div>
                            )}
                            {meal.estimated_cost !== undefined && (
                              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                                💴 {[itinerary.currency, meal.estimated_cost.toLocaleString()].filter(Boolean).join(" ")}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {pickingMeal && day.id === pickingMeal.dayId && (
                      <MealPicker
                        itineraryId={data.id}
                        dayId={pickingMeal.dayId}
                        mealType={pickingMeal.mealType}
                        currency={itinerary.currency}
                        mealLabel={
                          { breakfast: "早餐", lunch: "午餐", dinner: "晚餐" }[pickingMeal.mealType]
                        }
                        onCancel={() => setPickingMeal(null)}
                        onSelected={(meal) => {
                          updateDayMeal(pickingMeal.dayId, pickingMeal.mealType, meal);
                          setPickingMeal(null);
                        }}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
            </Fragment>
          );
        })}
      </div>

      <DragOverlay>
        {activeStop ? <StopDragPreview stop={activeStop} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { PlacePhotoThumb } from "@/components/PlacePhotoThumb";
import TransitRecommendationCard from "@/components/TransitRecommendationCard";
import type { TransitRecommendation } from "@/types/itinerary";
import { SUSPICIOUS_DISTANCE_KM as NEAREST_CITY_KM_THRESHOLD, haversineKm } from "@/lib/distanceMatrix";
import { iataToCity } from "@/lib/airports";
import { useItinerarySensors } from "@/hooks/useItinerarySensors";
import { useSortableItem } from "@/hooks/useSortableItem";

// Same threshold as src/lib/nearestCity.ts's NEAREST_CITY_KM_THRESHOLD —
// imported from distanceMatrix.ts (not nearestCity.ts itself) because that
// module pulls in server-only deps (Google API key, prisma place cache) that
// can't ship to the client bundle.
const PRIMARY_CITY_KEY = "__primary__";
const MAX_TARGET_DAYS = 14;

export interface RestructureDayLite {
  id: string;
  day: number;
  theme?: string;
  isTransitDay?: boolean;
  isLocked?: boolean;
  waypointCity?: string;
  stopCount: number;
}

interface LockedAttractionState {
  key: string;
  name: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  address?: string;
  rating?: number | null;
  photoName?: string | null;
  priceLevel?: number | null;
}

interface CityEntryState {
  key: string;
  name: string;
  isNew: boolean;
  existingDayIds: string[]; // original day order — empty for new cities
  structuralDayIds: Set<string>; // transit-out / trip-return days — always kept
  keepDayIds: Set<string>;
  touchedKeep: boolean;
  targetDays: number; // total days for this city, including structural days
  lockedAttractions: LockedAttractionState[];
  fromRecommendation: boolean; // added via the 周邊推薦 cards, counts against the insertion cap
  lat?: number; // used only to place a newly-added city near its geographic
  lng?: number; // neighbor — see findInsertionIndex
}

// Cheapest-insertion heuristic: try every gap in the existing sequence
// (before the first city, between each pair, after the last) and pick
// whichever adds the least extra distance. A gap next to a city with no
// resolved coordinates is skipped rather than guessed at; if that leaves no
// usable gap at all (e.g. no coordinates resolved yet), append at the end —
// the same fixed behavior this heuristic replaces.
function findInsertionIndex(
  cities: { lat?: number; lng?: number }[],
  lat: number,
  lng: number
): number {
  const dist = (a: { lat?: number; lng?: number }, b: { lat?: number; lng?: number }) =>
    a.lat != null && a.lng != null && b.lat != null && b.lng != null
      ? haversineKm(a.lat, a.lng, b.lat, b.lng)
      : null;

  let bestIndex = cities.length;
  let bestCost = Infinity;

  for (let i = 0; i <= cities.length; i++) {
    const prev = i > 0 ? cities[i - 1] : undefined;
    const next = i < cities.length ? cities[i] : undefined;
    const toPrev = prev ? dist(prev, { lat, lng }) : null;
    const toNext = next ? dist(next, { lat, lng }) : null;
    const prevToNext = prev && next ? dist(prev, next) : null;

    let cost: number | null;
    if (prev && next) {
      cost = toPrev != null && toNext != null && prevToNext != null ? toPrev + toNext - prevToNext : null;
    } else if (prev) {
      cost = toPrev;
    } else {
      cost = toNext;
    }

    if (cost != null && cost < bestCost) {
      bestCost = cost;
      bestIndex = i;
    }
  }

  return bestIndex;
}

// The longer the original trip, the more 周邊推薦 cities may be inserted —
// short trips have no slack to absorb an extra stop.
function maxRecommendedInsertions(totalDays: number): number {
  if (totalDays >= 9) return 3;
  if (totalDays >= 7) return 2;
  if (totalDays >= 4) return 1;
  return 0;
}

interface RestructurePanelProps {
  itineraryId: string;
  days: RestructureDayLite[];
  onClose: () => void;
  onApplied: () => void;
  originIata?: string;
  destinationIata?: string;
  isSingleCity?: boolean;
  existingStops?: string[];
  returnDate?: string;
}

// Days carry no date of their own, so growing/shrinking the trip shifts
// returnDate by the same delta server-side — this mirrors that shift purely
// for the step 2/4 preview text. Keep in sync with shiftDateString in
// src/app/api/v1/itinerary/[id]/restructure/route.ts.
function shiftDateString(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

type RecommendationState = "loading" | "ready" | "error" | "empty";

const HOUR_FILTERS: { label: string; test: (hours: number) => boolean }[] = [
  { label: "不限", test: () => true },
  { label: "≤ 2 小時", test: (hours) => hours <= 2 },
  { label: "2–4 小時", test: (hours) => hours > 2 && hours <= 4 },
];

// A transit day or the trip's very last day doesn't represent a day actually
// spent sightseeing in its assigned city — mirrors isStructuralDay in the
// restructure API route.
function computeStructuralDayIds(days: RestructureDayLite[]): Set<string> {
  const ids = new Set(days.filter((d) => d.isTransitDay).map((d) => d.id));
  const last = days[days.length - 1];
  if (last) ids.add(last.id);
  return ids;
}

function groupExistingDays(days: RestructureDayLite[], structuralIds: Set<string>): CityEntryState[] {
  const buckets = new Map<string, RestructureDayLite[]>();
  for (const day of days) {
    const key = day.waypointCity || PRIMARY_CITY_KEY;
    const list = buckets.get(key) ?? [];
    list.push(day);
    buckets.set(key, list);
  }
  return Array.from(buckets.entries()).map(([key, bucketDays]) => {
    const ids = bucketDays.map((d) => d.id);
    const cityStructuralIds = new Set(ids.filter((id) => structuralIds.has(id)));
    return {
      key: crypto.randomUUID(),
      name: key === PRIMARY_CITY_KEY ? "" : key,
      isNew: false,
      existingDayIds: ids,
      structuralDayIds: cityStructuralIds,
      keepDayIds: new Set(ids),
      touchedKeep: false,
      targetDays: ids.length,
      lockedAttractions: [],
      fromRecommendation: false,
    };
  });
}

// Number of structural (transit/return) days baked into a city's targetDays:
// a new city always has exactly 1 (its leading transit day); an existing
// city has however many of its kept days are structural.
function structuralCount(city: CityEntryState): number {
  return city.isNew ? 1 : city.structuralDayIds.size;
}

// Total days actually spent on this city block. `targetDays` is the total
// the user sets and sees directly — what you set is what you get — so this
// is just an alias kept for readability at call sites.
function totalCityDays(city: CityEntryState): number {
  return city.targetDays;
}

function defaultKeepIds(city: CityEntryState): Set<string> {
  const sightseeingIds = city.existingDayIds.filter((id) => !city.structuralDayIds.has(id));
  const cap = Math.max(0, city.targetDays - structuralCount(city) - city.lockedAttractions.length);
  return new Set([...sightseeingIds.slice(0, cap), ...city.structuralDayIds]);
}

// Reconciles keepDayIds against `city`'s (already-updated) targetDays and
// lockedAttractions. Untouched cities just get the recommended keep list
// recomputed. A touched city's manual picks are preserved as-is UNLESS the
// new, lower targetDays no longer has room for all of them — in that case
// the excess manually-kept sightseeing days (latest-first) are dropped so
// the actual day count restructure will produce can never exceed what this
// panel displays. Without this, shrinking a city after hand-picking which
// days to keep silently produced more days than targetDays, pushing the
// trip over its original total.
function syncKeepDaysForTarget(city: CityEntryState): CityEntryState {
  if (!city.touchedKeep) return { ...city, keepDayIds: defaultKeepIds(city) };
  const sightseeingKeepOrder = city.existingDayIds.filter(
    (id) => !city.structuralDayIds.has(id) && city.keepDayIds.has(id)
  );
  const cap = Math.max(0, city.targetDays - structuralCount(city) - city.lockedAttractions.length);
  if (sightseeingKeepOrder.length <= cap) return city;
  return {
    ...city,
    keepDayIds: new Set([...sightseeingKeepOrder.slice(0, cap), ...city.structuralDayIds]),
  };
}

function SortableCityEntry({
  city,
  draggable,
  onNameChange,
  onRemove,
  onRemoveAttraction,
}: {
  city: CityEntryState;
  draggable: boolean;
  onNameChange: (name: string) => void;
  onRemove: () => void;
  onRemoveAttraction: (attractionKey: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging, style: sortableStyle } = useSortableItem(city.key);

  const style = { ...sortableStyle, opacity: isDragging ? 0.5 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        {draggable && (
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
        )}
        {city.name ? (
          <p className="flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {city.name}
            {!city.isNew && <span className="ml-1.5 text-xs font-normal text-zinc-400">（既有）</span>}
            {city.isNew && <span className="ml-1.5 text-xs font-normal text-emerald-600 dark:text-emerald-400">（新增）</span>}
          </p>
        ) : (
          <input
            type="text"
            placeholder="這是哪個城市？例：名古屋"
            onChange={(e) => onNameChange(e.target.value)}
            className="flex-1 px-2 py-1 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        )}
        {city.isNew && (
          <button
            onClick={onRemove}
            className="text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 p-1 rounded transition-colors shrink-0"
            aria-label={`移除 ${city.name}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {city.lockedAttractions.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {city.lockedAttractions.map((a) => (
            <div key={a.key} className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
              <span>🔒</span>
              <PlacePhotoThumb placeId={a.placeId} photoName={a.photoName} size={28} />
              <span className="flex-1">{a.name}</span>
              <button
                onClick={() => onRemoveAttraction(a.key)}
                className="flex items-center gap-1 shrink-0 text-zinc-500 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 px-1.5 py-0.5 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                移除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RestructurePanel({
  itineraryId,
  days,
  onClose,
  onApplied,
  originIata,
  destinationIata,
  isSingleCity = false,
  existingStops,
  returnDate,
}: RestructurePanelProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [cities, setCities] = useState<CityEntryState[]>(() =>
    groupExistingDays(days, computeStructuralDayIds(days))
  );
  const [mode, setMode] = useState<"city" | "attraction">("city");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pendingAttraction, setPendingAttraction] = useState<LockedAttractionState | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [capHint, setCapHint] = useState<{ cityKey: string; text: string } | null>(null);

  // Resolve coordinates for the trip's starting cities once on mount, purely
  // to seed findInsertionIndex — a newly-added city is only ever positioned
  // by geography relative to cities whose coordinates are already known.
  // Manually-typed/searched/recommended cities carry their own coordinates
  // from the moment they're added, so they never need this fetch.
  useEffect(() => {
    const names = cities.filter((c) => c.name.trim()).map((c) => c.name);
    if (names.length === 0) return;
    let cancelled = false;
    fetch("/api/v1/places/city-centers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cityNames: names }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { centers: Record<string, { lat: number; lng: number } | null> } | null) => {
        if (cancelled || !data) return;
        setCities((prev) =>
          prev.map((c) => {
            const center = data.centers[c.name];
            return c.lat == null && center ? { ...c, lat: center.lat, lng: center.lng } : c;
          })
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suggested nearby/onward cities, fetched once on mount and reused across steps.
  // Trips too short to absorb even one inserted stop skip the fetch entirely.
  const [recState, setRecState] = useState<RecommendationState>(
    originIata && destinationIata && maxRecommendedInsertions(days.length) > 0 ? "loading" : "empty"
  );
  const [recommendations, setRecommendations] = useState<TransitRecommendation[]>([]);
  const [hourFilterIndex, setHourFilterIndex] = useState(0);
  const dismissedNamesRef = useRef<Set<string>>(new Set());
  const autoRefreshOnEmptyRef = useRef(false);
  // The trip's own base city/cities (from the flight's origin/destination airports) —
  // recommending these back is redundant since they were never really a "suggestion",
  // so they're dropped entirely rather than shown as an "already added" card. Cities
  // the traveler separately added from a past recommendation still get that card.
  const baseCityNamesRef = useRef<Set<string>>(
    new Set(
      [originIata, destinationIata]
        .filter((iata): iata is string => Boolean(iata))
        .map((iata) => iataToCity(iata).toLowerCase())
    )
  );

  const daysById = new Map(days.map((d) => [d.id, d]));
  // The trip's original total day count. Growing or shrinking it is allowed —
  // days carry no date of their own (see shiftDateString above), so the
  // backend shifts flightInfo.returnDate by the same delta on apply to keep
  // it in sync, rather than capping totalAfter at this value.
  const totalBefore = days.length;
  const maxRecommendedInserts = maxRecommendedInsertions(totalBefore);
  const recommendedInsertedCount = cities.filter((c) => c.fromRecommendation).length;
  const totalAfter = cities.reduce((sum, c) => sum + totalCityDays(c), 0);
  const dayDelta = totalAfter - totalBefore;
  const newReturnDate = returnDate && dayDelta !== 0 ? shiftDateString(returnDate, dayDelta) : undefined;

  const applyRecommendations = useCallback(
    (recs: TransitRecommendation[]) => {
      const existingLower = existingStops?.map((s) => s.toLowerCase()) ?? [];
      const dismissed = dismissedNamesRef.current;
      const baseCityNames = baseCityNamesRef.current;
      // Substring match (not just exact) because existingStops includes raw stop
      // names like "維利奇卡鹽礦", which won't equal a recommendation's plain
      // city name like "維利奇卡" but clearly refers to the same place.
      const matchesExisting = (name: string) => {
        const lower = name.toLowerCase();
        return existingLower.some((s) => s.includes(lower));
      };
      const filtered = recs.filter(
        (rec) =>
          !dismissed.has(rec.name) &&
          !baseCityNames.has(rec.name.toLowerCase()) &&
          !matchesExisting(rec.name) &&
          (!rec.iataCode || !existingLower.includes(rec.iataCode.toLowerCase()))
      );
      if (filtered.length === 0) {
        setRecState("empty");
      } else {
        setRecommendations(filtered);
        setRecState("ready");
      }
    },
    [existingStops]
  );

  const fetchRecommendations = useCallback(
    (forceRefresh = false) => {
      if (!originIata || !destinationIata || maxRecommendedInsertions(days.length) === 0) return () => {};

      setRecState("loading");
      setRecommendations([]);
      let cancelled = false;

      fetch(`/api/v1/itinerary/${itineraryId}/transit-recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originIata, destinationIata, existingStops, forceRefresh }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("推薦失敗");
          return res.json() as Promise<{ recommendations: TransitRecommendation[] }>;
        })
        .then((data) => {
          if (cancelled) return;
          applyRecommendations(data.recommendations);
        })
        .catch(() => {
          if (!cancelled) setRecState("error");
        });

      return () => {
        cancelled = true;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itineraryId, originIata, destinationIata, applyRecommendations]
  );

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    queueMicrotask(() => {
      if (cancelled) return;
      cleanup = fetchRecommendations();
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRecommendations]);

  useEffect(() => {
    if (recState !== "ready" || recommendations.length !== 0) return;
    queueMicrotask(() => {
      if (autoRefreshOnEmptyRef.current) {
        autoRefreshOnEmptyRef.current = false;
        fetchRecommendations(true);
      } else {
        setRecState("empty");
      }
    });
  }, [recommendations, recState, fetchRecommendations]);

  const handleIndividualRefresh = useCallback((recName: string) => {
    dismissedNamesRef.current.add(recName);
    setRecommendations((prev) => {
      const next = prev.filter((r) => r.name !== recName);
      if (next.length === 0) autoRefreshOnEmptyRef.current = true;
      return next;
    });
  }, []);

  const visibleRecommendations = recommendations.filter((r) =>
    HOUR_FILTERS[hourFilterIndex].test(r.transitTimeHours)
  );

  const dragSensors = useItinerarySensors();

  const handleCityDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDirty(true);
    setCities((prev) => {
      const oldIndex = prev.findIndex((c) => c.key === active.id);
      const newIndex = prev.findIndex((c) => c.key === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const updateCity = (key: string, updater: (c: CityEntryState) => CityEntryState) => {
    setDirty(true);
    setCities((prev) => prev.map((c) => (c.key === key ? updater(c) : c)));
  };

  const handleClose = () => {
    if (dirty && !confirm("目前的變更尚未套用，確定要放棄並關閉嗎？")) return;
    onClose();
  };

  const addAttractionToCity = (cityKey: string, attraction: LockedAttractionState) => {
    updateCity(cityKey, (c) => {
      const lockedAttractions = [...c.lockedAttractions, attraction];
      const targetDays = c.targetDays + 1;
      return syncKeepDaysForTarget({ ...c, lockedAttractions, targetDays });
    });
  };

  const removeAttraction = (cityKey: string, attractionKey: string) => {
    updateCity(cityKey, (c) => {
      const lockedAttractions = c.lockedAttractions.filter((a) => a.key !== attractionKey);
      const minDays = Math.max(1, lockedAttractions.length + structuralCount(c));
      const targetDays = Math.max(minDays, c.targetDays - 1);
      return syncKeepDaysForTarget({ ...c, lockedAttractions, targetDays });
    });
  };

  const removeCity = (key: string) => {
    setDirty(true);
    setCities((prev) => prev.filter((c) => c.key !== key));
  };

  const addRecommendedCity = (rec: TransitRecommendation, targetDays: number) => {
    if (cities.some((c) => c.name === rec.name)) return;
    if (recommendedInsertedCount >= maxRecommendedInserts) return;
    setDirty(true);
    setCities((prev) => {
      const entry: CityEntryState = {
        key: crypto.randomUUID(),
        name: rec.name,
        isNew: true,
        existingDayIds: [],
        structuralDayIds: new Set(),
        keepDayIds: new Set(),
        touchedKeep: false,
        targetDays,
        lockedAttractions: [],
        fromRecommendation: true,
        lat: rec.lat,
        lng: rec.lng,
      };
      const next = [...prev];
      next.splice(findInsertionIndex(prev, rec.lat, rec.lng), 0, entry);
      return next;
    });
  };

  const setTargetDays = (key: string, targetDays: number) => {
    updateCity(key, (c) => {
      const minDays = Math.max(1, c.lockedAttractions.length + structuralCount(c));
      const clamped = Math.max(minDays, Math.min(MAX_TARGET_DAYS, targetDays));
      let hintText: string | null = null;

      if (targetDays > MAX_TARGET_DAYS) {
        hintText = `已達單一城市最多 ${MAX_TARGET_DAYS} 天`;
      } else if (targetDays < minDays) {
        hintText = "已達最少天數（含鎖定景點與交通日）";
      }

      if (hintText) {
        setCapHint({ cityKey: key, text: hintText });
        window.setTimeout(() => setCapHint((h) => (h?.cityKey === key ? null : h)), 2500);
      }
      return syncKeepDaysForTarget({ ...c, targetDays: clamped });
    });
  };

  const toggleKeep = (cityKey: string, dayId: string) => {
    updateCity(cityKey, (c) => {
      const keepDayIds = new Set(c.keepDayIds);
      if (keepDayIds.has(dayId)) {
        keepDayIds.delete(dayId);
      } else {
        keepDayIds.add(dayId);
      }
      return { ...c, keepDayIds, touchedKeep: true };
    });
  };

  const resetKeepToRecommended = (cityKey: string) => {
    updateCity(cityKey, (c) => ({ ...c, keepDayIds: defaultKeepIds(c), touchedKeep: false }));
  };

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      if (mode === "city") {
        const res = await fetch("/api/v1/places/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "搜尋失敗");
        if (!data.place) {
          setSearchError("找不到這個城市，換個名稱試試");
          return;
        }
        const name = data.place.displayName.text;
        if (cities.some((c) => c.name === name)) {
          setSearchError("已經加入過這個城市了");
          return;
        }
        const lat = data.place.location.latitude as number;
        const lng = data.place.location.longitude as number;
        setDirty(true);
        setCities((prev) => {
          const entry: CityEntryState = {
            key: crypto.randomUUID(),
            name,
            isNew: true,
            existingDayIds: [],
            structuralDayIds: new Set(),
            keepDayIds: new Set(),
            touchedKeep: false,
            targetDays: 3, // 1 transit day + 2 sightseeing days by default
            lockedAttractions: [],
            fromRecommendation: false,
            lat,
            lng,
          };
          const next = [...prev];
          next.splice(findInsertionIndex(prev, lat, lng), 0, entry);
          return next;
        });
        setQuery("");
      } else {
        const candidateCities = cities.map((c) => c.name).filter(Boolean);
        if (candidateCities.length === 0) {
          setSearchError("請先加入至少一個城市，才能加入景點");
          return;
        }
        const res = await fetch("/api/v1/places/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, candidateCities }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "搜尋失敗");
        if (!data.place) {
          setSearchError(data.error || "找不到這個景點，換個名稱試試");
          return;
        }
        const place = data.place;
        const attraction: LockedAttractionState = {
          key: crypto.randomUUID(),
          name: place.displayName.text,
          placeId: place.id,
          lat: place.location.latitude,
          lng: place.location.longitude,
          address: place.formattedAddress,
          rating: place.rating ?? null,
          photoName: place.photos?.[0]?.name ?? null,
          priceLevel: place.priceLevel ?? null,
        };
        const nearest = data.nearestCity as { city: string; distanceKm: number } | null;
        if (nearest && nearest.distanceKm <= NEAREST_CITY_KM_THRESHOLD) {
          const target = cities.find((c) => c.name === nearest.city);
          if (target) addAttractionToCity(target.key, attraction);
        } else {
          setPendingAttraction(attraction);
        }
        setQuery("");
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "搜尋失敗");
    } finally {
      setSearching(false);
    }
  };

  const resolvePendingAttraction = (cityKey: string) => {
    if (!pendingAttraction) return;
    addAttractionToCity(cityKey, pendingAttraction);
    setPendingAttraction(null);
  };

  const step1Ready =
    cities.length > 0 &&
    cities.every((c) => c.name.trim().length > 0) &&
    !pendingAttraction;

  const handleApply = async () => {
    setApplying(true);
    setApplyError(null);
    try {
      const res = await fetch(`/api/v1/itinerary/${itineraryId}/restructure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cities: cities.map((c) => ({
            name: c.name,
            isNew: c.isNew,
            targetDays: c.targetDays,
            keepDayIds: c.existingDayIds.filter((id) => c.keepDayIds.has(id)),
            lockedAttractions: c.lockedAttractions.map((a) => ({
              name: a.name,
              placeId: a.placeId,
              lat: a.lat,
              lng: a.lng,
              address: a.address,
              rating: a.rating,
              photoName: a.photoName,
              priceLevel: a.priceLevel,
            })),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "套用失敗");
      onApplied();
      onClose();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "套用失敗");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50 dark:bg-indigo-950/20 overflow-hidden">
      <div className="px-4 py-3 border-b border-indigo-200 dark:border-indigo-800/50 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-100">重新規劃行程</h4>
          <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">第 {step} / 4 步</p>
        </div>
        <button
          onClick={handleClose}
          disabled={applying}
          className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="關閉"
          title={applying ? "套用中，請稍候" : undefined}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Step 1: add cities / attractions */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-xs w-fit">
              <button
                onClick={() => setMode("city")}
                className={`px-3 py-1.5 transition-colors ${mode === "city" ? "bg-indigo-600 text-white" : "bg-white dark:bg-zinc-900 text-zinc-500"}`}
              >
                城市
              </button>
              <button
                onClick={() => setMode("attraction")}
                className={`px-3 py-1.5 transition-colors ${mode === "attraction" ? "bg-indigo-600 text-white" : "bg-white dark:bg-zinc-900 text-zinc-500"}`}
              >
                必去景點
              </button>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder={mode === "city" ? "輸入城市名稱，例：大阪" : "輸入景點名稱，例：LEGOLAND Japan"}
                disabled={searching}
                className="flex-1 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              />
              <button
                onClick={handleSearch}
                disabled={searching || !query.trim()}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm transition-colors shrink-0"
              >
                {searching ? "搜尋中…" : "加入"}
              </button>
            </div>
            {searchError && <p className="text-xs text-red-600 dark:text-red-400">{searchError}</p>}

            {pendingAttraction && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  「{pendingAttraction.name}」不確定屬於哪個城市，請選擇：
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {cities.filter((c) => c.name).map((c) => (
                    <button
                      key={c.key}
                      onClick={() => resolvePendingAttraction(c.key)}
                      className="text-xs px-2.5 py-1 rounded-full bg-white dark:bg-zinc-800 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                    >
                      {c.name}
                    </button>
                  ))}
                  <button
                    onClick={() => setPendingAttraction(null)}
                    className="text-xs px-2.5 py-1 rounded-full text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleCityDragEnd}>
              <SortableContext items={cities.map((c) => c.key)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {cities.map((city) => (
                    <SortableCityEntry
                      key={city.key}
                      city={city}
                      draggable={city.isNew}
                      onNameChange={(name) => updateCity(city.key, (c) => ({ ...c, name }))}
                      onRemove={() => removeCity(city.key)}
                      onRemoveAttraction={(attractionKey) => removeAttraction(city.key, attractionKey)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {mode === "city" && originIata && destinationIata && maxRecommendedInserts > 0 && (
              <div className="rounded-lg border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-950/20 overflow-hidden">
                <div className="px-3 py-2.5 flex items-center justify-between border-b border-violet-200 dark:border-violet-800/50">
                  <div>
                    <h5 className="text-xs font-bold text-violet-900 dark:text-violet-100">
                      {isSingleCity ? "周邊推薦" : "順路推薦"}
                    </h5>
                    <p className="text-xs text-violet-600 dark:text-violet-400">
                      {isSingleCity
                        ? `從 ${originIata} 出發可順遊的周邊城市，加入後可拖曳到清單任意位置`
                        : `${originIata} → ${destinationIata} 途中值得停留的城市，加入後可拖曳到清單任意位置`}
                    </p>
                    <p className="text-xs text-violet-500 dark:text-violet-500 mt-0.5">
                      原行程 {totalBefore} 天，最多可插入 {maxRecommendedInserts} 個推薦城市（已加入 {recommendedInsertedCount} 個）
                    </p>
                  </div>
                  {recState !== "loading" && (
                    <button
                      onClick={() => fetchRecommendations(true)}
                      className="text-violet-400 hover:text-violet-600 dark:hover:text-violet-300 transition-colors p-1 rounded shrink-0"
                      aria-label="換一批推薦"
                      title="換一批"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="px-3 py-2 border-b border-violet-200 dark:border-violet-800/50 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-violet-500 dark:text-violet-400 shrink-0">車程篩選</span>
                  <div className="flex gap-1.5">
                    {HOUR_FILTERS.map(({ label }, index) => (
                      <button
                        key={label}
                        onClick={() => setHourFilterIndex(index)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                          hourFilterIndex === index
                            ? "bg-violet-600 text-white dark:bg-violet-500"
                            : "bg-violet-100 text-violet-600 hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-300 dark:hover:bg-violet-900/60"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3">
                  {recState === "loading" && (
                    <div className="flex items-center gap-3 py-2 text-sm text-violet-600 dark:text-violet-400">
                      <svg className="animate-spin w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      正在分析行程，尋找推薦城市…
                    </div>
                  )}

                  {recState === "error" && (
                    <div className="text-center py-3">
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">暫時無法取得推薦，稍後再試看看？</p>
                      <button
                        onClick={() => fetchRecommendations(true)}
                        className="text-sm px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
                      >
                        重新整理
                      </button>
                    </div>
                  )}

                  {recState === "empty" && (
                    <div className="text-center py-2">
                      <p className="text-sm text-violet-600 dark:text-violet-400 mb-2">已沒有其他推薦城市。</p>
                      <button
                        onClick={() => fetchRecommendations(true)}
                        className="text-sm px-3 py-1.5 rounded-lg bg-violet-100 hover:bg-violet-200 dark:bg-violet-900/40 dark:hover:bg-violet-900/60 text-violet-700 dark:text-violet-300 transition-colors"
                      >
                        換一批推薦
                      </button>
                    </div>
                  )}

                  {recState === "ready" && visibleRecommendations.length === 0 && (
                    <div className="text-center py-2">
                      <p className="text-sm text-violet-600 dark:text-violet-400 mb-2">
                        目前篩選條件下沒有符合的城市，試試放寬車程上限？
                      </p>
                      <button
                        onClick={() => setHourFilterIndex(0)}
                        className="text-sm px-3 py-1.5 rounded-lg bg-violet-100 hover:bg-violet-200 dark:bg-violet-900/40 dark:hover:bg-violet-900/60 text-violet-700 dark:text-violet-300 transition-colors"
                      >
                        顯示全部
                      </button>
                    </div>
                  )}

                  {recState === "ready" && visibleRecommendations.length > 0 && (
                    <div className="space-y-3">
                      {visibleRecommendations.map((rec) => (
                        <TransitRecommendationCard
                          key={`${rec.name}-${rec.country}`}
                          recommendation={rec}
                          isAdded={cities.some((c) => c.name === rec.name)}
                          disabled={recommendedInsertedCount >= maxRecommendedInserts}
                          onAdd={addRecommendedCity}
                          onRefresh={() => handleIndividualRefresh(rec.name)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: day counts */}
        {step === 2 && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              已依你加入的必去景點試算建議天數，可用 +/- 微調每個城市的總天數。
            </p>
            <div
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-semibold ${
                dayDelta !== 0
                  ? "border-amber-300 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400"
                  : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300"
              }`}
            >
              <span>總天數（原訂 {totalBefore} 天）</span>
              <span>{totalAfter} / {totalBefore} 天</span>
            </div>
            {newReturnDate && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {dayDelta > 0
                  ? `天數增加 ${dayDelta} 天，套用後回程日期將順延至 ${newReturnDate}`
                  : `天數減少 ${-dayDelta} 天，套用後回程日期將提前至 ${newReturnDate}`}
              </p>
            )}
            {cities.map((city) => (
              <div key={city.key} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">{city.name}</p>
                    {city.lockedAttractions.length > 0 && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate">
                        含 {city.lockedAttractions.length} 個鎖定景點日
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setTargetDays(city.key, city.targetDays - 1)}
                      className="w-6 h-6 flex items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm transition-colors"
                    >
                      −
                    </button>
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 w-6 text-center">{totalCityDays(city)}</span>
                    <button
                      onClick={() => setTargetDays(city.key, city.targetDays + 1)}
                      disabled={city.targetDays >= MAX_TARGET_DAYS}
                      title={city.targetDays >= MAX_TARGET_DAYS ? `已達單一城市最多 ${MAX_TARGET_DAYS} 天` : undefined}
                      className="w-6 h-6 flex items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      +
                    </button>
                    <span className="text-xs text-zinc-400 ml-0.5">天</span>
                  </div>
                </div>
                {capHint?.cityKey === city.key && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 text-right">{capHint.text}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Step 3: keep/discard checklist for existing cities being shrunk */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              移動日／回程日會自動保留，不列在下方清單中。
            </p>
            {cities
              .filter((c) => !c.isNew && c.existingDayIds.some((id) => !c.structuralDayIds.has(id)))
              .map((city) => (
              <div key={city.key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{city.name}</p>
                  <button
                    onClick={() => resetKeepToRecommended(city.key)}
                    className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                  >
                    還原建議勾選
                  </button>
                </div>
                <div className="space-y-1">
                  {city.existingDayIds.filter((id) => !city.structuralDayIds.has(id)).map((id) => {
                    const day = daysById.get(id);
                    if (!day) return null;
                    return (
                      <label
                        key={id}
                        className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={city.keepDayIds.has(id)}
                          onChange={() => toggleKeep(city.key, id)}
                          className="rounded border-zinc-300 dark:border-zinc-600 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-zinc-700 dark:text-zinc-300">
                          第 {day.day} 天{day.theme ? `・${day.theme}` : ""}
                          {day.isLocked && " 🔒"}
                        </span>
                        <span className="text-xs text-zinc-400 ml-auto">{day.stopCount} 個景點</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            {cities.every((c) => c.isNew || c.existingDayIds.every((id) => c.structuralDayIds.has(id))) && (
              <p className="text-sm text-zinc-400 dark:text-zinc-500">沒有需要保留/捨棄的既有天數。</p>
            )}
          </div>
        )}

        {/* Step 4: diff + confirm */}
        {step === 4 && (
          <div className="space-y-3">
            {cities.map((city) => {
              const removed = city.existingDayIds.filter((id) => !city.keepDayIds.has(id));
              const keptCount = city.existingDayIds.filter((id) => city.keepDayIds.has(id)).length;
              const sightseeingKeptCount = city.existingDayIds.filter(
                (id) => city.keepDayIds.has(id) && !city.structuralDayIds.has(id)
              ).length;
              const addedAiDays = Math.max(
                0,
                city.targetDays - structuralCount(city) - sightseeingKeptCount - city.lockedAttractions.length
              );
              return (
                <div key={city.key} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 space-y-1.5">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {city.name} · 共 {totalCityDays(city)} 天
                  </p>
                  {keptCount > 0 && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">保留原本 {keptCount} 天</p>
                  )}
                  {removed.length > 0 && (
                    <p className="text-xs text-red-500 dark:text-red-400">
                      移除：{removed.map((id) => daysById.get(id)?.theme || `第 ${daysById.get(id)?.day} 天`).join("、")}
                    </p>
                  )}
                  {addedAiDays > 0 && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">AI 新規劃 {addedAiDays} 天</p>
                  )}
                  {city.lockedAttractions.length > 0 && (
                    <p className="text-xs text-purple-600 dark:text-purple-400">
                      🔒 鎖定景點日：{city.lockedAttractions.map((a) => a.name).join("、")}
                    </p>
                  )}
                </div>
              );
            })}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-zinc-500 dark:text-zinc-400">原有天數</span>
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">{totalBefore} 天</span>
              </div>
              <div
                className={`flex items-center justify-between text-xs font-bold border-t border-zinc-200 dark:border-zinc-700 pt-1.5 mt-1 ${
                  dayDelta !== 0 ? "text-amber-700 dark:text-amber-400" : ""
                }`}
              >
                <span>套用後總天數</span>
                <span>{totalAfter} 天</span>
              </div>
            </div>
            {newReturnDate && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold">
                套用後總天數（{totalAfter} 天）與原訂 {totalBefore} 天不同，回程日期將
                {dayDelta > 0 ? "順延" : "提前"}至 {newReturnDate}。
              </p>
            )}
            {applyError && <p className="text-xs text-red-600 dark:text-red-400">{applyError}</p>}
          </div>
        )}

        {/* Nav */}
        <div className="flex items-center justify-between pt-2 border-t border-indigo-100 dark:border-indigo-900/40">
          <button
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
            disabled={step === 1 || applying}
            className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30 transition-colors"
          >
            上一步
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep((s) => (s < 4 ? ((s + 1) as 2 | 3 | 4) : s))}
              disabled={step === 1 && !step1Ready}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              下一步
            </button>
          ) : (
            <button
              onClick={handleApply}
              disabled={applying}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
            >
              {applying ? "套用中…" : "套用至行程"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

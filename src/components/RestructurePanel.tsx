"use client";

import { useState } from "react";
import { PlacePhotoThumb } from "@/components/PlacePhotoThumb";

// Mirrors NEAREST_CITY_KM_THRESHOLD in src/lib/nearestCity.ts — duplicated
// here because that helper pulls in server-only deps (Google API key, prisma
// place cache) that can't ship to the client bundle.
const NEAREST_CITY_KM_THRESHOLD = 80;
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
}

interface CityEntryState {
  key: string;
  name: string;
  isNew: boolean;
  existingDayIds: string[]; // original day order — empty for new cities
  structuralDayIds: Set<string>; // transit-out / trip-return days — always kept, excluded from targetDays budget
  keepDayIds: Set<string>;
  touchedKeep: boolean;
  targetDays: number;
  lockedAttractions: LockedAttractionState[];
}

interface RestructurePanelProps {
  itineraryId: string;
  days: RestructureDayLite[];
  onClose: () => void;
  onApplied: () => void;
}

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
    const sightseeingCount = ids.length - cityStructuralIds.size;
    return {
      key: crypto.randomUUID(),
      name: key === PRIMARY_CITY_KEY ? "" : key,
      isNew: false,
      existingDayIds: ids,
      structuralDayIds: cityStructuralIds,
      keepDayIds: new Set(ids),
      touchedKeep: false,
      targetDays: sightseeingCount,
      lockedAttractions: [],
    };
  });
}

// Total days actually spent on this city block, including the structural
// (transit/return) days that are always kept but aren't part of the AI
// sightseeing budget in `targetDays` — this is what's shown to the user, who
// shouldn't need to reason about the sightseeing/structural split.
function totalCityDays(city: CityEntryState): number {
  return city.isNew ? city.targetDays + 1 : city.targetDays + city.structuralDayIds.size;
}

function defaultKeepIds(city: CityEntryState): Set<string> {
  const sightseeingIds = city.existingDayIds.filter((id) => !city.structuralDayIds.has(id));
  const cap = Math.max(0, city.targetDays - city.lockedAttractions.length);
  return new Set([...sightseeingIds.slice(0, cap), ...city.structuralDayIds]);
}

export default function RestructurePanel({ itineraryId, days, onClose, onApplied }: RestructurePanelProps) {
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

  const daysById = new Map(days.map((d) => [d.id, d]));

  const updateCity = (key: string, updater: (c: CityEntryState) => CityEntryState) => {
    setCities((prev) => prev.map((c) => (c.key === key ? updater(c) : c)));
  };

  const addAttractionToCity = (cityKey: string, attraction: LockedAttractionState) => {
    updateCity(cityKey, (c) => {
      const lockedAttractions = [...c.lockedAttractions, attraction];
      const targetDays = c.targetDays + 1;
      const next = { ...c, lockedAttractions, targetDays };
      return c.touchedKeep ? next : { ...next, keepDayIds: defaultKeepIds(next) };
    });
  };

  const removeAttraction = (cityKey: string, attractionKey: string) => {
    updateCity(cityKey, (c) => {
      const lockedAttractions = c.lockedAttractions.filter((a) => a.key !== attractionKey);
      const targetDays = Math.max(1, c.targetDays - 1);
      const next = { ...c, lockedAttractions, targetDays };
      return c.touchedKeep ? next : { ...next, keepDayIds: defaultKeepIds(next) };
    });
  };

  const removeCity = (key: string) => {
    setCities((prev) => prev.filter((c) => c.key !== key));
  };

  const setTargetDays = (key: string, targetDays: number) => {
    updateCity(key, (c) => {
      const clamped = Math.max(Math.max(1, c.lockedAttractions.length), Math.min(MAX_TARGET_DAYS, targetDays));
      const next = { ...c, targetDays: clamped };
      return c.touchedKeep ? next : { ...next, keepDayIds: defaultKeepIds(next) };
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
        setCities((prev) => [
          ...prev,
          {
            key: crypto.randomUUID(),
            name,
            isNew: true,
            existingDayIds: [],
            structuralDayIds: new Set(),
            keepDayIds: new Set(),
            touchedKeep: false,
            targetDays: 2,
            lockedAttractions: [],
          },
        ]);
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
          setSearchError("找不到這個景點，換個名稱試試");
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

  const totalBefore = days.length;
  const totalAfter = cities.reduce((sum, c) => sum + totalCityDays(c), 0);

  return (
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50 dark:bg-indigo-950/20 overflow-hidden">
      <div className="px-4 py-3 border-b border-indigo-200 dark:border-indigo-800/50 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-100">重新規劃行程</h4>
          <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">第 {step} / 4 步</p>
        </div>
        <button
          onClick={onClose}
          className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
          aria-label="關閉"
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

            <div className="space-y-2">
              {cities.map((city) => (
                <div key={city.key} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3">
                  <div className="flex items-center justify-between gap-2">
                    {city.name ? (
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {city.name}
                        {!city.isNew && <span className="ml-1.5 text-xs font-normal text-zinc-400">（既有）</span>}
                        {city.isNew && <span className="ml-1.5 text-xs font-normal text-emerald-600 dark:text-emerald-400">（新增）</span>}
                      </p>
                    ) : (
                      <input
                        type="text"
                        placeholder="這是哪個城市？例：名古屋"
                        onChange={(e) => updateCity(city.key, (c) => ({ ...c, name: e.target.value }))}
                        className="flex-1 px-2 py-1 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    )}
                    {city.isNew && (
                      <button
                        onClick={() => removeCity(city.key)}
                        className="text-zinc-300 dark:text-zinc-600 hover:text-red-400 transition-colors shrink-0"
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
                            onClick={() => removeAttraction(city.key, a.key)}
                            className="text-zinc-300 dark:text-zinc-600 hover:text-red-400 transition-colors"
                          >
                            移除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: day counts */}
        {step === 2 && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              已依你加入的必去景點試算建議天數，可用 +/- 微調每個城市的總天數。
            </p>
            {cities.map((city) => (
              <div key={city.key} className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2.5">
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
                    className="w-6 h-6 flex items-center justify-center rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm transition-colors"
                  >
                    +
                  </button>
                  <span className="text-xs text-zinc-400 ml-0.5">天</span>
                </div>
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
              const addedAiDays = Math.max(0, city.targetDays - sightseeingKeptCount - city.lockedAttractions.length);
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
              <div className="flex items-center justify-between text-xs font-bold border-t border-zinc-200 dark:border-zinc-700 pt-1.5 mt-1">
                <span>套用後總天數</span>
                <span>{totalAfter} 天</span>
              </div>
            </div>
            {applyError && <p className="text-xs text-red-600 dark:text-red-400">{applyError}</p>}
          </div>
        )}

        {/* Nav */}
        <div className="flex items-center justify-between pt-2 border-t border-indigo-100 dark:border-indigo-900/40">
          <button
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
            disabled={step === 1}
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
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
            >
              {applying ? "套用中…" : "套用至行程"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

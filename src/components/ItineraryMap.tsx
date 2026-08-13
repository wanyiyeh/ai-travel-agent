"use client";

import { useState, useEffect } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
  useMap,
} from "@vis.gl/react-google-maps";
import type { Day } from "@/types/itinerary";

const DAY_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#ec4899",
];

interface MapStop {
  id: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
  address?: string;
  rating?: number | null;
  dayIndex: number;
  stopIndex: number;
  timeOfDay?: "morning" | "afternoon" | "evening";
}

interface MapAccommodation {
  dayId: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
  address?: string;
  rating?: number | null;
  placeId?: string;
  dayIndex: number;
}

type MealType = "breakfast" | "lunch" | "dinner" | "snack";

interface MapMeal {
  dayId: string;
  mealType: MealType;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  rating?: number | null;
  dayIndex: number;
}

const MEAL_META: Record<MealType, { icon: string; label: string }> = {
  breakfast: { icon: "🌅", label: "早餐" },
  lunch: { icon: "☀️", label: "午餐" },
  snack: { icon: "🍰", label: "點心" },
  dinner: { icon: "🌙", label: "晚餐" },
};

interface ItineraryMapProps {
  itineraryId: string;
  days: Day[];
  context?: string;
}

// --- Inner component: has access to map instance via useMap ---
function MapContent({
  visibleStops,
  visibleAccommodations,
  visibleMeals,
  selectedStop,
  selectedAccommodation,
  selectedMeal,
  onStopClick,
  onAccommodationClick,
  onMealClick,
  onCloseInfoWindow,
}: {
  visibleStops: MapStop[];
  visibleAccommodations: MapAccommodation[];
  visibleMeals: MapMeal[];
  selectedStop: MapStop | null;
  selectedAccommodation: MapAccommodation | null;
  selectedMeal: MapMeal | null;
  onStopClick: (stop: MapStop) => void;
  onAccommodationClick: (acc: MapAccommodation) => void;
  onMealClick: (meal: MapMeal) => void;
  onCloseInfoWindow: () => void;
}) {
  const map = useMap();

  // Auto-fit bounds whenever visible stops, accommodations, or meals change
  useEffect(() => {
    const allPoints = [
      ...visibleStops.map((s) => ({ lat: s.lat, lng: s.lng })),
      ...visibleAccommodations.map((a) => ({ lat: a.lat, lng: a.lng })),
      ...visibleMeals.map((m) => ({ lat: m.lat, lng: m.lng })),
    ];
    if (!map || allPoints.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    allPoints.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, 60);
  }, [map, visibleStops, visibleAccommodations, visibleMeals]);

  // Draw polylines per day group, weaving meals in by time of day
  useEffect(() => {
    if (!map || visibleStops.length + visibleMeals.length < 2) return;

    const dayIndices = new Set([
      ...visibleStops.map((s) => s.dayIndex),
      ...visibleMeals.map((m) => m.dayIndex),
    ]);

    const polylines: google.maps.Polyline[] = [];

    dayIndices.forEach((dayIndex) => {
      const sorted = visibleStops
        .filter((s) => s.dayIndex === dayIndex)
        .sort((a, b) => a.stopIndex - b.stopIndex);
      const meals = visibleMeals.filter((m) => m.dayIndex === dayIndex);
      const breakfast = meals.find((m) => m.mealType === "breakfast");
      const lunch = meals.find((m) => m.mealType === "lunch");
      const snack = meals.find((m) => m.mealType === "snack");
      const dinner = meals.find((m) => m.mealType === "dinner");

      // Insert lunch right before the first afternoon-tagged stop; if no stop
      // is tagged, fall back to the midpoint of the day's stops.
      const withLunch: Array<MapStop | MapMeal> = [];
      let lunchInserted = false;
      sorted.forEach((s) => {
        if (lunch && !lunchInserted && s.timeOfDay === "afternoon") {
          withLunch.push(lunch);
          lunchInserted = true;
        }
        withLunch.push(s);
      });
      if (lunch && !lunchInserted) {
        withLunch.splice(Math.ceil(withLunch.length / 2), 0, lunch);
      }

      const ordered: Array<MapStop | MapMeal> = [];
      if (breakfast) ordered.push(breakfast);
      ordered.push(...withLunch);
      if (snack) ordered.push(snack);
      if (dinner) ordered.push(dinner);

      if (ordered.length < 2) return;

      const path = ordered.map((s) => ({ lat: s.lat, lng: s.lng }));

      const polyline = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor: DAY_COLORS[dayIndex % DAY_COLORS.length],
        strokeOpacity: 0.75,
        strokeWeight: 3,
        map,
        clickable: true,
        icons: [
          {
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 3,
              strokeColor: DAY_COLORS[dayIndex % DAY_COLORS.length],
            },
            offset: "100%",
          },
        ],
      });

      // Click polyline → open Google Maps directions for this day's route
      polyline.addListener("click", () => {
        const origin = `${path[0].lat},${path[0].lng}`;
        const destination = `${path[path.length - 1].lat},${path[path.length - 1].lng}`;
        const waypoints = path
          .slice(1, -1)
          .map((p) => `${p.lat},${p.lng}`)
          .join("|");
        const url = new URL("https://www.google.com/maps/dir/");
        url.searchParams.set("api", "1");
        url.searchParams.set("origin", origin);
        url.searchParams.set("destination", destination);
        if (waypoints) url.searchParams.set("waypoints", waypoints);
        url.searchParams.set("travelmode", "driving");
        window.open(url.toString(), "_blank");
      });

      polylines.push(polyline);
    });

    return () => {
      polylines.forEach((p) => p.setMap(null));
    };
  }, [map, visibleStops, visibleMeals]);

  return (
    <>
      {visibleStops.map((stop) => (
        <AdvancedMarker
          key={stop.id}
          position={{ lat: stop.lat, lng: stop.lng }}
          onClick={() => onStopClick(stop)}
        >
          <div
            style={{
              background: DAY_COLORS[stop.dayIndex % DAY_COLORS.length],
              color: "white",
              borderRadius: "50%",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
              fontSize: "12px",
              border: "2px solid white",
              boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
              cursor: "pointer",
            }}
          >
            {stop.stopIndex + 1}
          </div>
        </AdvancedMarker>
      ))}

      {visibleAccommodations.map((acc) => (
        <AdvancedMarker
          key={`acc-${acc.dayId}`}
          position={{ lat: acc.lat, lng: acc.lng }}
          onClick={() => onAccommodationClick(acc)}
        >
          <div
            style={{
              background: "#6366f1",
              color: "white",
              borderRadius: "6px",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              border: "2px solid white",
              boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
              cursor: "pointer",
            }}
          >
            🏨
          </div>
        </AdvancedMarker>
      ))}

      {visibleMeals.map((meal) => (
        <AdvancedMarker
          key={`meal-${meal.dayId}-${meal.mealType}`}
          position={{ lat: meal.lat, lng: meal.lng }}
          onClick={() => onMealClick(meal)}
        >
          <div
            style={{
              background: "#f59e0b",
              color: "white",
              borderRadius: "6px",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              border: "2px solid white",
              boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
              cursor: "pointer",
            }}
          >
            {MEAL_META[meal.mealType].icon}
          </div>
        </AdvancedMarker>
      ))}

      {selectedStop && (
        <InfoWindow
          position={{ lat: selectedStop.lat, lng: selectedStop.lng }}
          onCloseClick={onCloseInfoWindow}
        >
          <div className="p-1 max-w-[220px] space-y-1">
            <div className="font-semibold text-zinc-900 text-sm">
              {selectedStop.name}
            </div>
            {selectedStop.address && (
              <div className="text-xs text-zinc-500">{selectedStop.address}</div>
            )}
            {selectedStop.rating != null && (
              <div className="text-xs text-amber-500">★ {selectedStop.rating}</div>
            )}
            <div className="text-xs text-zinc-600">{selectedStop.description}</div>
          </div>
        </InfoWindow>
      )}

      {selectedAccommodation && (
        <InfoWindow
          position={{ lat: selectedAccommodation.lat, lng: selectedAccommodation.lng }}
          onCloseClick={onCloseInfoWindow}
        >
          <div className="p-1 max-w-[220px] space-y-1">
            <div className="font-semibold text-zinc-900 text-sm">
              🏨 {selectedAccommodation.name}
            </div>
            <div className="text-xs text-zinc-500">{selectedAccommodation.area}</div>
            {selectedAccommodation.address && (
              <div className="text-xs text-zinc-500">{selectedAccommodation.address}</div>
            )}
            {selectedAccommodation.rating != null && (
              <div className="text-xs text-amber-500">★ {selectedAccommodation.rating}</div>
            )}
            {selectedAccommodation.placeId && (
              <a
                href={`https://www.google.com/maps/place/?q=place_id:${selectedAccommodation.placeId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-indigo-600 font-medium hover:underline mt-1"
              >
                在地圖上查看 →
              </a>
            )}
          </div>
        </InfoWindow>
      )}

      {selectedMeal && (
        <InfoWindow
          position={{ lat: selectedMeal.lat, lng: selectedMeal.lng }}
          onCloseClick={onCloseInfoWindow}
        >
          <div className="p-1 max-w-[220px] space-y-1">
            <div className="font-semibold text-zinc-900 text-sm">
              {MEAL_META[selectedMeal.mealType].icon} {selectedMeal.name}
            </div>
            <div className="text-xs text-zinc-500">
              {MEAL_META[selectedMeal.mealType].label}
            </div>
            {selectedMeal.address && (
              <div className="text-xs text-zinc-500">{selectedMeal.address}</div>
            )}
            {selectedMeal.rating != null && (
              <div className="text-xs text-amber-500">★ {selectedMeal.rating}</div>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}

// --- Main export ---
export default function ItineraryMap({
  itineraryId,
  days,
  context,
}: ItineraryMapProps) {
  const [mapStops, setMapStops] = useState<MapStop[]>([]);
  const [mapAccommodations, setMapAccommodations] = useState<MapAccommodation[]>([]);
  const [mapMeals, setMapMeals] = useState<MapMeal[]>([]);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState(0);
  const [totalToEnrich, setTotalToEnrich] = useState(0);
  const [selectedStop, setSelectedStop] = useState<MapStop | null>(null);
  const [selectedAccommodation, setSelectedAccommodation] = useState<MapAccommodation | null>(null);
  const [selectedMeal, setSelectedMeal] = useState<MapMeal | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);

  useEffect(() => {
    async function run() {
      const alreadyEnriched: MapStop[] = [];
      const needsEnrich: Array<{
        id: string;
        name: string;
        description: string;
        dayIndex: number;
        stopIndex: number;
        timeOfDay?: "morning" | "afternoon" | "evening";
      }> = [];

      setMapAccommodations([]);
      setMapMeals([]);

      days.forEach((day, dayIndex) => {
        day.stops.forEach((stop, stopIndex) => {
          if (!stop.id) return;
          if (stop.lat && stop.lng) {
            alreadyEnriched.push({
              id: stop.id,
              name: stop.name,
              description: stop.description,
              lat: stop.lat,
              lng: stop.lng,
              address: stop.address ?? undefined,
              rating: stop.rating,
              dayIndex,
              stopIndex,
              timeOfDay: stop.time_of_day,
            });
          } else {
            needsEnrich.push({
              id: stop.id,
              name: stop.name,
              description: stop.description,
              dayIndex,
              stopIndex,
              timeOfDay: stop.time_of_day,
            });
          }
        });
      });

      setMapStops(alreadyEnriched);

      // Collect meals with lat/lng already available
      days.forEach((day, dayIndex) => {
        if (!day.id || !day.meals) return;
        (["breakfast", "lunch", "dinner", "snack"] as const).forEach((mealType) => {
          const meal = day.meals?.[mealType];
          if (!meal || !meal.lat || !meal.lng) return;
          setMapMeals((prev) => {
            if (prev.some((m) => m.dayId === day.id && m.mealType === mealType)) return prev;
            return [
              ...prev,
              {
                dayId: day.id!,
                mealType,
                name: meal.name,
                lat: meal.lat!,
                lng: meal.lng!,
                address: meal.address,
                rating: meal.rating,
                dayIndex,
              },
            ];
          });
        });
      });

      // Collect accommodations with lat/lng already available
      days.forEach((day, dayIndex) => {
        if (!day.id || !day.accommodation) return;
        const acc = day.accommodation;
        if (acc.lat && acc.lng) {
          setMapAccommodations((prev) => {
            if (prev.some((a) => a.dayId === day.id)) return prev;
            return [
              ...prev,
              {
                dayId: day.id!,
                name: acc.name ?? acc.area,
                area: acc.area,
                lat: acc.lat!,
                lng: acc.lng!,
                address: acc.address,
                rating: acc.rating,
                placeId: acc.placeId,
                dayIndex,
              },
            ];
          });
        }
      });

      // Enrich accommodations that lack lat/lng
      const needsAccEnrich = days
        .map((day, dayIndex) => ({ day, dayIndex }))
        .filter(({ day }) => day.id && day.accommodation && !day.accommodation.lat);

      for (const { day, dayIndex } of needsAccEnrich) {
        try {
          const res = await fetch(`/api/v1/days/${day.id}/accommodation/enrich`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itineraryId }),
          });
          if (res.ok) {
            const { accommodation: acc } = await res.json();
            if (acc.lat && acc.lng) {
              setMapAccommodations((prev) => {
                if (prev.some((a) => a.dayId === day.id)) return prev;
                return [
                  ...prev,
                  {
                    dayId: day.id!,
                    name: acc.name ?? acc.area,
                    area: acc.area,
                    lat: acc.lat,
                    lng: acc.lng,
                    address: acc.address,
                    rating: acc.rating,
                    placeId: acc.placeId,
                    dayIndex,
                  },
                ];
              });
            }
          }
        } catch {
          // skip
        }
      }

      if (needsEnrich.length === 0) return;

      setEnriching(true);
      setTotalToEnrich(needsEnrich.length);
      setEnrichProgress(0);

      for (const stop of needsEnrich) {
        try {
          const res = await fetch(`/api/v1/stops/${stop.id}/enrich`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itineraryId, context }),
          });

          if (res.ok) {
            const result = await res.json();
            setMapStops((prev) => {
              if (prev.some((s) => s.id === stop.id)) return prev;
              return [
                ...prev,
                {
                  id: stop.id,
                  name: stop.name,
                  description: stop.description,
                  lat: result.lat,
                  lng: result.lng,
                  address: result.address,
                  rating: result.rating,
                  dayIndex: stop.dayIndex,
                  stopIndex: stop.stopIndex,
                  timeOfDay: stop.timeOfDay,
                },
              ];
            });
          }
        } catch {
          // skip failed stop
        }
        setEnrichProgress((prev) => prev + 1);
      }

      setEnriching(false);
    }

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const visibleStops =
    selectedDayIndex === null
      ? mapStops
      : mapStops.filter((s) => s.dayIndex === selectedDayIndex);

  const visibleAccommodations =
    selectedDayIndex === null
      ? mapAccommodations
      : mapAccommodations.filter((a) => a.dayIndex === selectedDayIndex);

  const visibleMeals =
    selectedDayIndex === null
      ? mapMeals
      : mapMeals.filter((m) => m.dayIndex === selectedDayIndex);

  const center =
    visibleStops.length > 0
      ? {
          lat:
            visibleStops.reduce((sum, s) => sum + s.lat, 0) /
            visibleStops.length,
          lng:
            visibleStops.reduce((sum, s) => sum + s.lng, 0) /
            visibleStops.length,
        }
      : { lat: 25.033, lng: 121.5654 };

  function handleDaySelect(idx: number | null) {
    setSelectedDayIndex(idx);
    setSelectedStop(null);
    setSelectedAccommodation(null);
    setSelectedMeal(null);
  }

  return (
    <div className="w-full space-y-3">
      {enriching && (
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          正在補完地點資訊… ({enrichProgress}/{totalToEnrich})
        </div>
      )}

      {/* Day selector */}
      {mapStops.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleDaySelect(null)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              selectedDayIndex === null
                ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            全部天數
          </button>
          {days.map((day, idx) => {
            const color = DAY_COLORS[idx % DAY_COLORS.length];
            const active = selectedDayIndex === idx;
            return (
              <button
                key={idx}
                onClick={() => handleDaySelect(idx)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors"
                style={
                  active
                    ? { background: color, color: "white" }
                    : {
                        background: "transparent",
                        border: `1.5px solid ${color}`,
                        color: color,
                      }
                }
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    background: active ? "rgba(255,255,255,0.65)" : color,
                  }}
                />
                第 {day.day} 天{day.theme ? ` · ${day.theme}` : ""}
              </button>
            );
          })}
        </div>
      )}

      {mapStops.length === 0 && !enriching && (
        <div className="h-64 flex items-center justify-center text-zinc-400 rounded-xl border border-zinc-200 dark:border-zinc-700">
          無法取得地點座標
        </div>
      )}

      {visibleStops.length === 0 && mapStops.length > 0 && !enriching && (
        <div className="h-64 flex items-center justify-center text-zinc-400 rounded-xl border border-zinc-200 dark:border-zinc-700">
          此天尚無座標資料
        </div>
      )}

      {(visibleStops.length > 0 || visibleAccommodations.length > 0 || visibleMeals.length > 0) && (
        <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
          <div
            className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700"
            style={{ height: "480px" }}
          >
            <Map
              defaultCenter={center}
              defaultZoom={13}
              mapId={
                process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID"
              }
              gestureHandling="greedy"
              disableDefaultUI={false}
            >
              <MapContent
                visibleStops={visibleStops}
                visibleAccommodations={visibleAccommodations}
                visibleMeals={visibleMeals}
                selectedStop={selectedStop}
                selectedAccommodation={selectedAccommodation}
                selectedMeal={selectedMeal}
                onStopClick={(stop) => {
                  setSelectedAccommodation(null);
                  setSelectedMeal(null);
                  setSelectedStop((prev) => prev?.id === stop.id ? null : stop);
                }}
                onAccommodationClick={(acc) => {
                  setSelectedStop(null);
                  setSelectedMeal(null);
                  setSelectedAccommodation((prev) => prev?.dayId === acc.dayId ? null : acc);
                }}
                onMealClick={(meal) => {
                  setSelectedStop(null);
                  setSelectedAccommodation(null);
                  setSelectedMeal((prev) =>
                    prev?.dayId === meal.dayId && prev?.mealType === meal.mealType ? null : meal
                  );
                }}
                onCloseInfoWindow={() => {
                  setSelectedStop(null);
                  setSelectedAccommodation(null);
                  setSelectedMeal(null);
                }}
              />
            </Map>
          </div>
        </APIProvider>
      )}
    </div>
  );
}

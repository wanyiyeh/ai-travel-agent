"use client";

import { useState, useEffect } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
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
}

interface ItineraryMapProps {
  itineraryId: string;
  days: Day[];
  context?: string;
}

export default function ItineraryMap({
  itineraryId,
  days,
  context,
}: ItineraryMapProps) {
  const [mapStops, setMapStops] = useState<MapStop[]>([]);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState(0);
  const [totalToEnrich, setTotalToEnrich] = useState(0);
  const [selectedStop, setSelectedStop] = useState<MapStop | null>(null);

  useEffect(() => {
    async function run() {
      const alreadyEnriched: MapStop[] = [];
      const needsEnrich: Array<{
        id: string;
        name: string;
        description: string;
        dayIndex: number;
        stopIndex: number;
      }> = [];

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
            });
          } else {
            needsEnrich.push({
              id: stop.id,
              name: stop.name,
              description: stop.description,
              dayIndex,
              stopIndex,
            });
          }
        });
      });

      setMapStops(alreadyEnriched);

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
  }, []);

  const center =
    mapStops.length > 0
      ? {
          lat: mapStops.reduce((sum, s) => sum + s.lat, 0) / mapStops.length,
          lng: mapStops.reduce((sum, s) => sum + s.lng, 0) / mapStops.length,
        }
      : { lat: 25.033, lng: 121.5654 };

  return (
    <div className="w-full space-y-3">
      {enriching && (
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          正在補完地點資訊… ({enrichProgress}/{totalToEnrich})
        </div>
      )}

      {mapStops.length === 0 && !enriching && (
        <div className="h-64 flex items-center justify-center text-zinc-400 rounded-xl border border-zinc-200 dark:border-zinc-700">
          無法取得地點座標
        </div>
      )}

      {mapStops.length > 0 && (
        <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
          <div
            className="rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-700"
            style={{ height: "480px" }}
          >
            <Map
              defaultCenter={center}
              defaultZoom={13}
              mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? "DEMO_MAP_ID"}
              gestureHandling="greedy"
              disableDefaultUI={false}
            >
              {mapStops.map((stop) => (
                <AdvancedMarker
                  key={stop.id}
                  position={{ lat: stop.lat, lng: stop.lng }}
                  onClick={() =>
                    setSelectedStop((prev) =>
                      prev?.id === stop.id ? null : stop
                    )
                  }
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

              {selectedStop && (
                <InfoWindow
                  position={{ lat: selectedStop.lat, lng: selectedStop.lng }}
                  onCloseClick={() => setSelectedStop(null)}
                >
                  <div className="p-1 max-w-[220px] space-y-1">
                    <div className="font-semibold text-zinc-900 text-sm">
                      {selectedStop.name}
                    </div>
                    {selectedStop.address && (
                      <div className="text-xs text-zinc-500">
                        {selectedStop.address}
                      </div>
                    )}
                    {selectedStop.rating != null && (
                      <div className="text-xs text-amber-500">
                        ★ {selectedStop.rating}
                      </div>
                    )}
                    <div className="text-xs text-zinc-600">
                      {selectedStop.description}
                    </div>
                  </div>
                </InfoWindow>
              )}
            </Map>
          </div>
        </APIProvider>
      )}

      {/* 圖例 */}
      {mapStops.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {days.map((day, idx) => (
            <div key={idx} className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <div
                className="w-3 h-3 rounded-full"
                style={{ background: DAY_COLORS[idx % DAY_COLORS.length] }}
              />
              第 {day.day} 天{day.theme ? ` · ${day.theme}` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

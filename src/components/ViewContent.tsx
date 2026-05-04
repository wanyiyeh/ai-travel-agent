"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import EditableItineraryCard from "@/components/EditableItineraryCard";
import ItineraryMap from "@/components/ItineraryMap";

interface ViewContentProps {
  id: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ItineraryData = any;

export default function ViewContent({ id }: ViewContentProps) {
  const [data, setData] = useState<ItineraryData>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");

  const fetchData = () => {
    setLoading(true);
    fetch(`/api/v1/itinerary/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("無法載入行程");
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded w-2/3 mx-auto" />
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden"
              >
                <div className="h-14 bg-zinc-200 dark:bg-zinc-700" />
                <div className="p-5 space-y-3">
                  {[1, 2].map((j) => (
                    <div key={j} className="flex gap-4">
                      <div className="w-9 h-9 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-3/4" />
                        <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4"
          >
            返回首頁
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4"
          >
            ← 新增行程
          </Link>
          <div className="flex items-center gap-4">
            {data && (
              <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-sm">
                <button
                  onClick={() => setView("list")}
                  className={`px-3 py-1.5 transition-colors ${
                    view === "list"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  }`}
                >
                  列表
                </button>
                <button
                  onClick={() => setView("map")}
                  className={`px-3 py-1.5 transition-colors ${
                    view === "map"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  }`}
                >
                  地圖
                </button>
              </div>
            )}
            <Link
              href="/itineraries"
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4"
            >
              已儲存的行程
            </Link>
          </div>
        </div>

        {data && (
          <>
            {view === "list" ? (
              <EditableItineraryCard data={data} onUpdate={fetchData} />
            ) : (
              <ItineraryMap
                itineraryId={data.id}
                days={data.data.days}
                context={data.config?.generatedWith}
              />
            )}

            {data.config && (
              <div className="mt-6 p-4 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
                {data.config.flightInfo && (
                  <>
                    <p>
                      去程：{data.config.flightInfo.departureCity}（出發）→ {data.config.flightInfo.arrivalCity}（抵達）・{data.config.flightInfo.departureDate}{data.config.flightInfo.arrivalTime ? `，落地 ${data.config.flightInfo.arrivalTime}` : ""}
                    </p>
                    <p>
                      回程：{data.config.flightInfo.returnDepartureCity}（出發）→ {data.config.flightInfo.departureCity}（抵達）・{data.config.flightInfo.returnDate}{data.config.flightInfo.returnDepartureTime ? `，起飛 ${data.config.flightInfo.returnDepartureTime}` : ""}
                    </p>
                  </>
                )}
                {data.config.generatedWith && (
                  <p>風格描述：{data.config.generatedWith}</p>
                )}
                {data.config.totalDays && (
                  <p>天數：{data.config.totalDays} 天</p>
                )}
                {data.createdAt && (
                  <p>
                    建立於：
                    {new Date(data.createdAt).toLocaleDateString("zh-TW", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import EditableItineraryCard from "@/components/EditableItineraryCard";
import ItineraryMap from "@/components/ItineraryMap";
import TransitRecommendationsPanel from "@/components/TransitRecommendationsPanel";
import type { TransitRecommendation, CartItem } from "@/types/itinerary";

const DEFAULT_EXCHANGE_RATES: Record<string, number> = {
  JPY: 0.21, KRW: 0.023, CNY: 4.4, HKD: 4.1, SGD: 24,
  AUD: 21, USD: 32, EUR: 35, GBP: 41, THB: 0.93, VND: 0.0013,
};

const IATA_DISPLAY: Record<string, string> = {
  TPE: "台北", KHH: "高雄", VIE: "維也納", PRG: "布拉格",
  BUD: "布達佩斯", BTS: "布拉提斯拉瓦", LJU: "盧布亞納",
  ZAG: "薩格勒布", DBV: "杜布羅夫尼克", SJJ: "薩拉熱窩",
  FRA: "法蘭克福", MUC: "慕尼黑", BER: "柏林",
  CDG: "巴黎", LHR: "倫敦", AMS: "阿姆斯特丹",
  FCO: "羅馬", BCN: "巴塞隆納", MAD: "馬德里", LIS: "里斯本",
  CPH: "哥本哈根", OSL: "奧斯陸", ARN: "斯德哥爾摩",
  NRT: "東京", KIX: "大阪", ICN: "首爾", BKK: "曼谷",
  SIN: "新加坡", HKG: "香港", SYD: "雪梨", MEL: "墨爾本",
  JFK: "紐約", LAX: "洛杉磯", DXB: "杜拜",
};

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
  const [exchangeRate, setExchangeRate] = useState(35);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [insertionReason, setInsertionReason] = useState("");
  const [insertAfterDay, setInsertAfterDay] = useState<number | undefined>(undefined);
  const transitPanelRef = useRef<HTMLDivElement>(null);

  const handleAddToCart = (rec: TransitRecommendation, stayDays: number) => {
    setCartItems((prev) => {
      if (prev.some((i) => i.recommendation.name === rec.name)) return prev;
      return [...prev, { recommendation: rec, stayDays, order: prev.length }];
    });
  };

  const handleRemoveFromCart = (name: string) => {
    setCartItems((prev) => prev.filter((i) => i.recommendation.name !== name));
  };

  const handleUpdateCartStayDays = (name: string, days: number) => {
    setCartItems((prev) =>
      prev.map((i) => (i.recommendation.name === name ? { ...i, stayDays: days } : i))
    );
  };

  const handleReorderCart = (newItems: CartItem[]) => {
    setCartItems(newItems);
  };

  const handleBatchApply = async () => {
    if (!data || cartItems.length === 0) return;
    setIsApplying(true);
    setInsertionReason("");
    try {
      const res = await fetch(`/api/v1/itinerary/${data.id}/batch-insert-waypoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cartItems.map(({ recommendation, stayDays }) => ({ recommendation, stayDays })),
          maxDays: transitPanelProps?.maxDays,
          insertAfterDay,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "批次插入失敗");
      }
      const result = await res.json();
      setCartItems([]);
      setInsertionReason(result.insertionReason ?? "");
    } catch {
      // keep cart intact so user can retry
    } finally {
      setIsApplying(false);
      fetchData();
    }
  };

  const scrollToTransitPanel = () => {
    transitPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calcDayCost = (stops: any[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stops.reduce((t: number, s: any) => t + (s.estimated_cost ?? 0), 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calcMealCost = (meals: any) =>
    (meals?.breakfast?.estimated_cost ?? 0) +
    (meals?.lunch?.estimated_cost ?? 0) +
    (meals?.dinner?.estimated_cost ?? 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasAnyCost = (days: any[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    days.some((d: any) => d.stops?.some((s: any) => s.estimated_cost !== undefined));

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

  useEffect(() => {
    if (data?.data?.currency) {
      setExchangeRate(DEFAULT_EXCHANGE_RATES[data.data.currency] ?? 35);
    }
  }, [data?.data?.currency]);

  useEffect(() => {
    const days = data?.data?.days;
    if (Array.isArray(days) && days.length > 1 && insertAfterDay === undefined) {
      setInsertAfterDay(Math.max(1, Math.floor(days.length / 2)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.data?.days]);

  const transitPanelProps = useMemo(() => {
    const flightInfo = data?.config?.flightInfo;
    if (!flightInfo) return null;
    const { arrivalCity, returnDepartureCity, departureDate, returnDate } = flightInfo;
    if (!arrivalCity || !returnDepartureCity) return null;
    const isSingleCity = arrivalCity === returnDepartureCity;
    let maxDays: number | undefined;
    if (departureDate && returnDate) {
      const dep = new Date(departureDate);
      const ret = new Date(returnDate);
      maxDays = Math.max(1, Math.ceil((ret.getTime() - dep.getTime()) / (1000 * 60 * 60 * 24)));
    }
    const currentDays = (data.data?.days as unknown[])?.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transitStopNames: string[] = (data.data?.days ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((d: any) => d.isTransitDay && d.transitTo)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d: any) => d.transitTo as string);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const daysList = (data.data?.days ?? []).map((d: any) => ({
      day: d.day as number,
      theme: (d.theme as string) ?? "",
      isTransitDay: d.isTransitDay === true,
    }));
    return {
      itineraryId: data.id as string,
      originIata: arrivalCity as string,
      destinationIata: returnDepartureCity as string,
      existingStops: [arrivalCity, ...transitStopNames, returnDepartureCity] as string[],
      maxDays,
      currentDays: currentDays as number | undefined,
      days: daysList,
      isSingleCity,
    };
  }, [data]);

  if (loading && !data) {
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

  const renderRouteBreadcrumb = () => {
    if (!data?.config?.flightInfo) return null;
    const { departureCity, returnDepartureCity, arrivalCity } = data.config.flightInfo;

    // Only user-inserted waypoints (waypointCity set by insert-waypoint route), deduplicated in order
    const waypointCities: string[] = [];
    const seenWaypoints = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const d of (data.data?.days ?? []) as any[]) {
      const city = d.waypointCity as string | undefined;
      if (city && !seenWaypoints.has(city)) {
        seenWaypoints.add(city);
        waypointCities.push(city);
      }
    }
    const waypointSet = new Set(waypointCities);

    const dest = returnDepartureCity || arrivalCity;
    const rawNodes = [departureCity, arrivalCity, ...waypointCities, dest].filter(Boolean) as string[];
    // Remove consecutive duplicates (e.g. single-city where arrivalCity === dest)
    const nodes = rawNodes.filter((n, i) => i === 0 || n !== rawNodes[i - 1]);
    if (nodes.length < 2) return null;

    return (
      <div className="mb-6 overflow-x-auto pb-1">
        <div className="flex items-center gap-1 min-w-max">
          {nodes.map((code: string, idx: number) => {
            const isWaypoint = waypointSet.has(code);
            const isEndpoint = idx === 0 || idx === nodes.length - 1;
            return (
              <div key={idx} className="flex items-center gap-1">
                {idx > 0 && (
                  <svg className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
                <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${
                  isWaypoint
                    ? "border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-950/20"
                    : isEndpoint
                    ? "border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-950/20"
                    : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                }`}>
                  <span className={`text-xs font-mono font-bold ${
                    isWaypoint
                      ? "text-violet-700 dark:text-violet-300"
                      : isEndpoint
                      ? "text-blue-700 dark:text-blue-300"
                      : "text-zinc-700 dark:text-zinc-300"
                  }`}>
                    {code}
                  </span>
                  {IATA_DISPLAY[code] && (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">{IATA_DISPLAY[code]}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCostSummary = () => {
    if (!data?.data?.days || !hasAnyCost(data.data.days)) return null;
    const cur = data.data.currency ?? "USD";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grandTotal = data.data.days.reduce((sum: number, d: any) =>
      sum + calcDayCost(d.stops ?? []) + calcMealCost(d.meals), 0);
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-4">
          <h3 className="text-base font-bold text-white">花費預估</h3>
          <div className="flex items-center gap-2 mt-1.5 text-sm text-white/90">
            <span>{cur} 1 =</span>
            <input
              type="number"
              value={exchangeRate}
              onChange={(e) => setExchangeRate(Math.max(1, Number(e.target.value) || 1))}
              className="w-16 px-2 py-0.5 rounded border border-white/30 bg-white/20 text-white text-sm text-center focus:outline-none focus:ring-2 focus:ring-white/50"
              min="1"
            />
            <span>TWD</span>
          </div>
        </div>
        <div className="p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th className="text-left pb-2 text-zinc-500 dark:text-zinc-400 font-medium">天數</th>
                <th className="text-right pb-2 text-zinc-500 dark:text-zinc-400 font-medium">{cur}</th>
                <th className="text-right pb-2 text-zinc-500 dark:text-zinc-400 font-medium">TWD</th>
              </tr>
            </thead>
            <tbody>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {data.data.days.map((day: any) => {
                const cost = calcDayCost(day.stops ?? []) + calcMealCost(day.meals);
                return (
                  <tr key={day.id || day.day} className="border-b border-zinc-50 dark:border-zinc-800/50">
                    <td className="py-1.5 text-zinc-700 dark:text-zinc-300">第 {day.day} 天</td>
                    <td className="py-1.5 text-right text-zinc-700 dark:text-zinc-300">{cost.toLocaleString()}</td>
                    <td className="py-1.5 text-right text-zinc-600 dark:text-zinc-400">{Math.round(cost * exchangeRate).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-zinc-200 dark:border-zinc-700">
                <td className="pt-2.5 font-bold text-zinc-900 dark:text-zinc-50">合計</td>
                <td className="pt-2.5 text-right font-bold text-zinc-900 dark:text-zinc-50">{grandTotal.toLocaleString()}</td>
                <td className="pt-2.5 text-right font-bold text-emerald-600 dark:text-emerald-400">{Math.round(grandTotal * exchangeRate).toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">* AI 預估值，實際費用可能有差異</p>
        </div>
      </div>
    );
  };

  const renderTransitPanel = () => {
    if (!transitPanelProps) return null;
    return (
      <div ref={transitPanelRef}>
        <TransitRecommendationsPanel
          itineraryId={transitPanelProps.itineraryId}
          originIata={transitPanelProps.originIata}
          destinationIata={transitPanelProps.destinationIata}
          existingStops={transitPanelProps.existingStops}
          onInserted={fetchData}
          maxDays={transitPanelProps.maxDays}
          currentDays={transitPanelProps.currentDays}
          days={transitPanelProps.days}
          insertAfterDay={insertAfterDay}
          onSelectInsertAfterDay={setInsertAfterDay}
          cartItems={cartItems}
          onAddToCart={handleAddToCart}
          onRemoveFromCart={handleRemoveFromCart}
          onUpdateCartStayDays={handleUpdateCartStayDays}
          onReorderCart={handleReorderCart}
          onBatchApply={handleBatchApply}
          isApplying={isApplying}
          insertionReason={insertionReason}
          isSingleCity={transitPanelProps.isSingleCity}
        />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4">
      <div className="max-w-7xl mx-auto">
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
            {renderRouteBreadcrumb()}

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
              {/* Main content */}
              <div>
                {view === "list" ? (
                  <EditableItineraryCard
                    data={data}
                    onUpdate={fetchData}
                    onExploreBorder={scrollToTransitPanel}
                    hideCostSummary
                  />
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
                    {data.config.generatedWith && <p>風格描述：{data.config.generatedWith}</p>}
                    {data.config.totalDays && <p>天數：{data.config.totalDays} 天</p>}
                    {data.createdAt && (
                      <p>
                        建立於：{new Date(data.createdAt).toLocaleDateString("zh-TW", {
                          year: "numeric", month: "long", day: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Sidebar */}
              <div className="space-y-4 lg:sticky lg:top-4 max-h-screen lg:overflow-y-auto lg:pb-4">
                {renderCostSummary()}
                {renderTransitPanel()}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

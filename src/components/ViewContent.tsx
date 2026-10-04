"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import EditableItineraryCard from "@/components/EditableItineraryCard";
import ItineraryMap from "@/components/ItineraryMap";
import RestructurePanel from "@/components/RestructurePanel";
import TrashView from "@/components/TrashView";
import GuestNotice from "@/components/GuestNotice";
import { signIn } from "next-auth/react";
import { calculateDayTotalCost, hasAnyStopCost } from "@/lib/costCalculations";
import { AIRPORTS } from "@/lib/airports";

const DEFAULT_EXCHANGE_RATES: Record<string, number> = {
  JPY: 0.21, KRW: 0.023, CNY: 4.4, HKD: 4.1, SGD: 24,
  AUD: 21, USD: 32, EUR: 35, GBP: 41, THB: 0.93, VND: 0.0013,
};

// How long "Download PDF" waits for lazy-loaded photos before printing anyway.
const PRINT_IMAGE_WAIT_MS = 5000;

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
  const [showRestructure, setShowRestructure] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  // "Download PDF" = the browser's print dialog ("Save as PDF") over a print
  // layout (globals.css @media print). While printing, the list view is shown
  // with every day expanded, since collapsed days aren't rendered at all.
  const [printing, setPrinting] = useState(false);
  const restructurePanelRef = useRef<HTMLDivElement>(null);

  const openRestructurePanel = () => {
    setShowRestructure(true);
    requestAnimationFrame(() => {
      restructurePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const itineraryTitle: string | undefined = data?.data?.title;
  useEffect(() => {
    if (!printing) return;
    // The PDF's default file name comes from the page title.
    const previousTitle = document.title;
    if (itineraryTitle) document.title = itineraryTitle;
    const done = () => {
      document.title = previousTitle;
      setPrinting(false);
    };
    window.addEventListener("afterprint", done, { once: true });

    // Photos are lazy-loaded, so ones further down the page haven't loaded
    // yet and would print as blanks. Load them all first (capped, so one
    // slow image can't hold the dialog back indefinitely).
    let cancelled = false;
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]'));
    images.forEach((img) => (img.loading = "eager"));
    const pending = images.filter((img) => !img.complete);
    const allLoaded = Promise.all(
      pending.map((img) => new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      })),
    );
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, PRINT_IMAGE_WAIT_MS));
    Promise.race([allLoaded, timeout]).then(() => {
      if (!cancelled) window.print();
    });

    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", done);
    };
  }, [printing, itineraryTitle]);

  // Guests' itineraries carry an expiry; downloading is for signed-in users
  // (plan/access-control.md §2), so a guest is sent to sign in instead.
  const isGuestItinerary = typeof data?.expiresInHours === "number";
  // Someone else's itinerary that its (admin) owner published as an example:
  // shown read-only (plan/access-control.md §8).
  const isPublicView = data?.access === "public";

  const [publishBusy, setPublishBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const togglePublic = async () => {
    setPublishBusy(true);
    try {
      const res = await fetch(`/api/v1/itinerary/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: !data?.isPublic }),
      });
      if (res.ok) fetchData();
    } finally {
      setPublishBusy(false);
    }
  };
  const copyPublicLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
    } catch {
      // Clipboard can be unavailable (permissions / non-HTTPS); the URL bar works too.
    }
  };
  const handleDownload = () => {
    if (isGuestItinerary) {
      signIn("google", { redirectTo: window.location.pathname });
      return;
    }
    setPrinting(true);
  };

  const fetchData = () => {
    setLoading(true);
    fetch(`/api/v1/itinerary/${id}`)
      .then((res) => {
        // 404 covers both "doesn't exist" and "not yours" on purpose.
        if (res.status === 401) throw new Error("請先登入才能查看行程");
        if (res.status === 404) throw new Error("找不到這個行程，或你沒有權限查看");
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
    const currency = data?.data?.currency;
    if (!currency) return;

    // Static table paints instantly; the live rate (if it arrives before the
    // user edits the field by hand) then overwrites it.
    setExchangeRate(DEFAULT_EXCHANGE_RATES[currency] ?? 35);

    let cancelled = false;
    fetch(`/api/v1/exchange-rate?base=${currency}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && typeof body?.rate === "number") {
          setExchangeRate(body.rate);
        }
      })
      .catch(() => {
        // keep the static fallback already set above
      });
    return () => {
      cancelled = true;
    };
  }, [data?.data?.currency]);

  const restructureRecommendationProps = useMemo(() => {
    const flightInfo = data?.config?.flightInfo;
    if (!flightInfo) return null;
    const { arrivalCity, returnDepartureCity } = flightInfo;
    if (!arrivalCity || !returnDepartureCity) return null;
    const transitStopNames: string[] = (data.data?.days ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((d: any) => d.isTransitDay && d.transitTo)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d: any) => d.transitTo as string);
    // Day-trip attractions (e.g. Wieliczka from Kraków) never get their own
    // isTransitDay/transitTo — they're just a stop on an existing city's day —
    // so without this, the recommendation prompt keeps re-suggesting a place
    // that's already sitting in the itinerary as a stop.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stopNames: string[] = (data.data?.days ?? []).flatMap((d: any) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d.stops ?? []).map((s: any) => s.name as string)
    );
    return {
      originIata: arrivalCity as string,
      destinationIata: returnDepartureCity as string,
      existingStops: [arrivalCity, ...transitStopNames, returnDepartureCity, ...stopNames] as string[],
      isSingleCity: arrivalCity === returnDepartureCity,
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
                  {AIRPORTS[code] && (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">{AIRPORTS[code].cityZh}</span>
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
    if (!data?.data?.days || !hasAnyStopCost(data.data.days)) return null;
    const cur = data.data.currency ?? "USD";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grandTotal = data.data.days.reduce((sum: number, d: any) =>
      sum + calculateDayTotalCost({ stops: d.stops ?? [], meals: d.meals, accommodation: d.accommodation }), 0);
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
                const cost = calculateDayTotalCost({ stops: day.stops ?? [], meals: day.meals, accommodation: day.accommodation });
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

  const renderRestructurePanel = () => {
    if (!data) return null;
    if (!showRestructure) {
      return (
        <button
          onClick={openRestructurePanel}
          className="w-full rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50 dark:bg-indigo-950/20 px-4 py-3 text-sm font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
        >
          重新規劃行程
        </button>
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restructureDays = (data.data?.days ?? []).map((d: any) => ({
      id: d.id as string,
      day: d.day as number,
      theme: d.theme as string | undefined,
      isTransitDay: d.isTransitDay === true,
      isLocked: d.isLocked === true,
      waypointCity: d.waypointCity as string | undefined,
      stopCount: Array.isArray(d.stops) ? d.stops.length : 0,
    }));
    return (
      <div ref={restructurePanelRef}>
        <RestructurePanel
          itineraryId={data.id}
          days={restructureDays}
          onClose={() => setShowRestructure(false)}
          onApplied={fetchData}
          originIata={restructureRecommendationProps?.originIata}
          destinationIata={restructureRecommendationProps?.destinationIata}
          existingStops={restructureRecommendationProps?.existingStops}
          isSingleCity={restructureRecommendationProps?.isSingleCity}
          returnDate={data.config?.flightInfo?.returnDate}
        />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4">
      <div className="max-w-7xl mx-auto">
        {typeof data?.expiresInHours === "number" && !isPublicView && <GuestNotice expiresInHours={data.expiresInHours} />}
        {isPublicView && (
          <div data-print-hidden className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
            <span>這是公開的範例行程，只能瀏覽、不能編輯。</span>
            <Link href="/" className="font-medium underline underline-offset-4">
              規劃我自己的行程 →
            </Link>
          </div>
        )}
        {/* Header */}
        <div className="mb-8 flex items-center justify-between" data-print-hidden>
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
            {data?.canPublish && (
              <span className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={togglePublic}
                  disabled={publishBusy}
                  title="公開後，任何人都能用這個網址以唯讀方式查看（不顯示風格描述）"
                  className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4 disabled:opacity-50"
                >
                  {data.isPublic ? "取消公開" : "設為公開範例"}
                </button>
                {data.isPublic && (
                  <button
                    type="button"
                    onClick={copyPublicLink}
                    className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300"
                  >
                    {linkCopied ? "已複製連結" : "已公開・複製連結"}
                  </button>
                )}
              </span>
            )}
            {data && !isPublicView && (
              <button
                type="button"
                onClick={handleDownload}
                title={isGuestItinerary ? "登入後即可下載 PDF" : "用瀏覽器的「另存為 PDF」下載"}
                className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4"
              >
                {isGuestItinerary ? "登入後下載 PDF" : "下載 PDF"}
              </button>
            )}
            {!isPublicView && (
              <button
                type="button"
                onClick={() => setShowTrash(true)}
                className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4"
              >
                垃圾桶
              </button>
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

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start print:block">
              {/* Main content */}
              <div>
                {view === "list" || printing ? (
                  <EditableItineraryCard
                    data={data}
                    onUpdate={fetchData}
                    onExploreBorder={openRestructurePanel}
                    hideCostSummary
                    expandAll={printing}
                    readOnly={isPublicView}
                  />
                ) : (
                  <ItineraryMap
                    itineraryId={data.id}
                    days={data.data.days}
                    context={data.config?.generatedWith}
                    readOnly={isPublicView}
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
              <div className="space-y-4 lg:sticky lg:top-4 max-h-screen lg:overflow-y-auto lg:pb-4 print:static print:max-h-none print:overflow-visible print:mt-6">
                {renderCostSummary()}
                {!isPublicView && <div data-print-hidden>{renderRestructurePanel()}</div>}
              </div>
            </div>
          </>
        )}
      </div>

      {showTrash && data && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10"
          onClick={() => setShowTrash(false)}
        >
          <div
            className="w-full max-w-3xl rounded-xl bg-zinc-50 dark:bg-zinc-950 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <TrashView itineraryId={id} onClose={() => setShowTrash(false)} onChange={fetchData} />
          </div>
        </div>
      )}
    </div>
  );
}

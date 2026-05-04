"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useStreamingGenerate } from "@/hooks/useStreamingGenerate";
import StreamingPreview from "@/components/StreamingPreview";
import type { TripPreferences, FlightInfo } from "@/lib/schemas";

const PACE_OPTIONS: { value: TripPreferences["pace"]; label: string; desc: string }[] = [
  { value: "relaxed", label: "悠閒", desc: "每天 ≤3 個景點" },
  { value: "moderate", label: "適中", desc: "每天 3-4 個景點" },
  { value: "intensive", label: "緊湊", desc: "每天 5+ 個景點" },
];

const BUDGET_OPTIONS: { value: TripPreferences["budget"]; label: string; desc: string }[] = [
  { value: "budget", label: "經濟實惠", desc: "平價為主" },
  { value: "moderate", label: "中等消費", desc: "一般觀光" },
  { value: "luxury", label: "高端奢華", desc: "頂級體驗" },
];

const INTEREST_OPTIONS: { value: NonNullable<TripPreferences["interests"]>[number]; label: string }[] = [
  { value: "food", label: "美食" },
  { value: "culture", label: "文化歷史" },
  { value: "nature", label: "自然景觀" },
  { value: "shopping", label: "購物" },
  { value: "adventure", label: "冒險戶外" },
];

function calcDays(departureDate: string, returnDate: string): number {
  if (!departureDate || !returnDate) return 0;
  const dep = new Date(departureDate);
  const ret = new Date(returnDate);
  return Math.max(0, Math.ceil((ret.getTime() - dep.getTime()) / (1000 * 60 * 60 * 24)));
}

export default function Home() {
  const router = useRouter();

  // 機票資訊（IATA 機場代號）
  const [departureCity, setDepartureCity] = useState("");
  const [arrivalCity, setArrivalCity] = useState("");
  const [returnDepartureCity, setReturnDepartureCity] = useState("");

  const toIATA = (val: string) => val.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [returnDepartureTime, setReturnDepartureTime] = useState("");

  // 行程描述與偏好
  const [prompt, setPrompt] = useState("");
  const [pace, setPace] = useState<TripPreferences["pace"]>(undefined);
  const [budget, setBudget] = useState<TripPreferences["budget"]>(undefined);
  const [interests, setInterests] = useState<NonNullable<TripPreferences["interests"]>>([]);

  const { state, partialData, id, error, generate, reset, isLoading } =
    useStreamingGenerate();

  const days = calcDays(departureDate, returnDate);

  function toggleInterest(val: NonNullable<TripPreferences["interests"]>[number]) {
    setInterests((prev) =>
      prev.includes(val) ? prev.filter((i) => i !== val) : [...prev, val]
    );
  }

  useEffect(() => {
    if (state === "complete" && id) {
      router.push(`/view/${id}`);
    }
  }, [state, id, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const flightInfo: FlightInfo = {
      departureCity,
      arrivalCity,
      returnDepartureCity: returnDepartureCity || arrivalCity,
      departureDate,
      returnDate,
      arrivalTime: arrivalTime || undefined,
      returnDepartureTime: returnDepartureTime || undefined,
    };

    const preferences: TripPreferences = {
      pace,
      budget,
      interests: interests.length ? interests : undefined,
    };

    await generate(prompt, flightInfo, preferences);
  }

  const isStreaming = state === "streaming" || state === "connecting";
  const isFormValid =
    departureCity.length === 3 &&
    arrivalCity.length === 3 &&
    departureDate &&
    returnDate &&
    days > 0;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-10 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
              AI Travel Agent
            </h1>
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">
              輸入機票資訊，讓 AI 幫你規劃行程與住宿
            </p>
          </div>
          <Link
            href="/itineraries"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4"
          >
            已儲存的行程
          </Link>
        </div>

        {/* Form – hidden while streaming */}
        {!isStreaming && state !== "complete" && (
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* 機票資訊 */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wide">
                機票資訊
              </h2>

              {/* 去程 */}
              <div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">去程</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label
                      htmlFor="departureCity"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      出發機場代號
                    </label>
                    <input
                      id="departureCity"
                      type="text"
                      value={departureCity}
                      onChange={(e) => setDepartureCity(toIATA(e.target.value))}
                      placeholder="TPE"
                      maxLength={3}
                      required
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm font-mono tracking-widest"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="arrivalCity"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      抵達機場代號
                    </label>
                    <input
                      id="arrivalCity"
                      type="text"
                      value={arrivalCity}
                      onChange={(e) => {
                        const code = toIATA(e.target.value);
                        setArrivalCity(code);
                        if (!returnDepartureCity) setReturnDepartureCity(code);
                      }}
                      placeholder="SYD"
                      maxLength={3}
                      required
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm font-mono tracking-widest"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="departureDate"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      去程日期
                    </label>
                    <input
                      id="departureDate"
                      type="date"
                      value={departureDate}
                      onChange={(e) => setDepartureDate(e.target.value)}
                      required
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="arrivalTime"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      航班抵達時間
                      <span className="font-normal text-zinc-400 ml-1">（選填）</span>
                    </label>
                    <input
                      id="arrivalTime"
                      type="time"
                      value={arrivalTime}
                      onChange={(e) => setArrivalTime(e.target.value)}
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* 回程 */}
              <div>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-2">回程</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label
                      htmlFor="returnDepartureCity"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      出發機場代號
                      <span className="font-normal text-zinc-400 ml-1">（若與抵達地不同）</span>
                    </label>
                    <input
                      id="returnDepartureCity"
                      type="text"
                      value={returnDepartureCity}
                      onChange={(e) => setReturnDepartureCity(toIATA(e.target.value))}
                      placeholder={arrivalCity || "MEL"}
                      maxLength={3}
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm font-mono tracking-widest"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      抵達機場代號
                    </label>
                    <div className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800/50 px-3 py-2.5 text-sm text-zinc-400 dark:text-zinc-500 font-mono tracking-widest">
                      {departureCity || "同去程出發地"}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="returnDate"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      回程日期
                    </label>
                    <input
                      id="returnDate"
                      type="date"
                      value={returnDate}
                      min={departureDate}
                      onChange={(e) => setReturnDate(e.target.value)}
                      required
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="returnDepartureTime"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                    >
                      航班出發時間
                      <span className="font-normal text-zinc-400 ml-1">（選填）</span>
                    </label>
                    <input
                      id="returnDepartureTime"
                      type="time"
                      value={returnDepartureTime}
                      onChange={(e) => setReturnDepartureTime(e.target.value)}
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2.5 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 text-sm"
                    />
                  </div>
                </div>
              </div>

              {days > 0 && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  共 <span className="font-semibold text-zinc-900 dark:text-zinc-50">{days} 天</span> 行程
                </p>
              )}
            </div>

            {/* 旅遊描述 */}
            <div>
              <label
                htmlFor="prompt"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
              >
                旅遊風格描述 <span className="font-normal text-zinc-400">（選填）</span>
              </label>
              <input
                id="prompt"
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例：以文化美食為主、想體驗當地生活"
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              />
            </div>

            {/* 步調 */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                步調與節奏
              </label>
              <div className="flex gap-2">
                {PACE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPace(pace === opt.value ? undefined : opt.value)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      pace === opt.value
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    }`}
                  >
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-xs opacity-60">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 預算 */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                預算區間
              </label>
              <div className="flex gap-2">
                {BUDGET_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setBudget(budget === opt.value ? undefined : opt.value)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      budget === opt.value
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    }`}
                  >
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-xs opacity-60">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 特殊偏好 */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                特殊偏好 <span className="font-normal text-zinc-400">（可複選）</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {INTEREST_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleInterest(opt.value)}
                    className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                      interests.includes(opt.value)
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || !isFormValid}
              className="w-full rounded-lg bg-zinc-900 dark:bg-zinc-50 px-4 py-3 text-sm font-semibold text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              生成行程
            </button>
          </form>
        )}

        {/* Error state */}
        {state === "error" && error && (
          <div className="mt-6 space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
            <button
              onClick={reset}
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4"
            >
              重新嘗試
            </button>
          </div>
        )}

        {/* Streaming preview */}
        {isStreaming && (
          <div className="mt-8">
            <StreamingPreview partialData={partialData} days={days} />
          </div>
        )}

        {/* Brief completion message before redirect */}
        {state === "complete" && (
          <div className="mt-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
            行程已生成，正在跳轉...
          </div>
        )}
      </div>
    </div>
  );
}

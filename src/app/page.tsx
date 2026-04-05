"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useStreamingGenerate } from "@/hooks/useStreamingGenerate";
import StreamingPreview from "@/components/StreamingPreview";
import type { TripPreferences } from "@/lib/schemas";

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

export default function Home() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [days, setDays] = useState(3);
  const [pace, setPace] = useState<TripPreferences["pace"]>(undefined);
  const [budget, setBudget] = useState<TripPreferences["budget"]>(undefined);
  const [interests, setInterests] = useState<NonNullable<TripPreferences["interests"]>>([]);
  const { state, partialData, id, error, generate, reset, isLoading } =
    useStreamingGenerate();

  function toggleInterest(val: NonNullable<TripPreferences["interests"]>[number]) {
    setInterests((prev) =>
      prev.includes(val) ? prev.filter((i) => i !== val) : [...prev, val]
    );
  }

  // Navigate to view page when generation is complete
  useEffect(() => {
    if (state === "complete" && id) {
      router.push(`/view/${id}`);
    }
  }, [state, id, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const preferences: TripPreferences = {
      pace,
      budget,
      interests: interests.length ? interests : undefined,
    };
    await generate(prompt, days, preferences);
  }

  const isStreaming = state === "streaming" || state === "connecting";

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
              輸入目的地，讓 AI 幫你規劃行程
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
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="prompt"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
              >
                目的地 / 旅遊描述
              </label>
              <input
                id="prompt"
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="例：東京文化美食之旅、京都賞楓 5 天"
                required
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              />
            </div>

            <div>
              <label
                htmlFor="days"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
              >
                天數
              </label>
              <select
                id="days"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              >
                {Array.from({ length: 14 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} 天
                  </option>
                ))}
              </select>
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
              disabled={isLoading || !prompt.trim()}
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

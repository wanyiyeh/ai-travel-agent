"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useStreamingGenerate } from "@/hooks/useStreamingGenerate";
import StreamingPreview from "@/components/StreamingPreview";

export default function Home() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [days, setDays] = useState(3);
  const { state, partialData, id, error, generate, reset, isLoading } =
    useStreamingGenerate();

  // Navigate to view page when generation is complete
  useEffect(() => {
    if (state === "complete" && id) {
      router.push(`/view/${id}`);
    }
  }, [state, id, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await generate(prompt, days);
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

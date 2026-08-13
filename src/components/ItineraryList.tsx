"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ItineraryItem = {
  id: string;
  title: string;
  createdAt: string;
  config: unknown;
};

export default function ItineraryList({ itineraries }: { itineraries: ItineraryItem[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetch(`/api/v1/itinerary/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  }

  if (itineraries.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-6 py-12 text-center text-zinc-400">
        還沒有任何行程，去首頁生成一個吧！
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {itineraries.map((item) => {
        const config = item.config as Record<string, unknown> | null;
        const totalDays =
          config && typeof config.totalDays === "number" ? config.totalDays : null;
        const isConfirming = confirmId === item.id;
        const isDeleting = deletingId === item.id;

        return (
          <li key={item.id} className="relative group">
            <Link
              href={`/view/${item.id}`}
              className="block rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-5 py-4 hover:border-blue-400 hover:shadow-sm transition-all pr-24"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-zinc-900 dark:text-zinc-50">
                    {item.title}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {new Date(item.createdAt).toLocaleDateString("zh-TW", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                    {totalDays && ` · ${totalDays} 天`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-300 dark:text-zinc-600 font-mono">
                    {item.id.slice(0, 8)}
                  </span>
                  <span className="text-xs text-blue-500">查看 →</span>
                </div>
              </div>
            </Link>

            {/* Delete button overlay */}
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              {isConfirming ? (
                <>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-2 py-1"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    disabled={isDeleting}
                    className="text-xs text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 px-2 py-1 rounded-md transition-colors"
                  >
                    {isDeleting ? "刪除中..." : "確認刪除"}
                  </button>
                </>
              ) : (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    setConfirmId(item.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-xs text-zinc-400 hover:text-red-500 transition-all px-2 py-1"
                >
                  刪除
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

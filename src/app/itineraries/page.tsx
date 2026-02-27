import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function ItinerariesPage() {
  const itineraries = await prisma.itinerary.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      config: true,
    },
  });

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-10 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
              已儲存的行程
            </h1>
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">
              共 {itineraries.length} 筆
            </p>
          </div>
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-4"
          >
            新增行程
          </Link>
        </div>

        {/* List */}
        {itineraries.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-6 py-12 text-center text-zinc-400">
            還沒有任何行程，去首頁生成一個吧！
          </div>
        ) : (
          <ul className="space-y-3">
            {itineraries.map((item) => {
              const config = item.config as Record<string, unknown> | null;
              const totalDays =
                config && typeof config.totalDays === "number"
                  ? config.totalDays
                  : null;

              return (
                <li key={item.id}>
                  <Link
                    href={`/view/${item.id}`}
                    className="block rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-5 py-4 hover:border-blue-400 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-zinc-900 dark:text-zinc-50">
                          {item.title}
                        </p>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {new Date(item.createdAt).toLocaleDateString(
                            "zh-TW",
                            {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            }
                          )}
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
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

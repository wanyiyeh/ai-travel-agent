import Link from "next/link";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth/actor";
import ItineraryList from "@/components/ItineraryList";

// This page reads the DB but uses no dynamic API, so Next.js was prerendering
// it at build time — freezing the saved-itinerary list at whatever the build
// machine's DB held (and failing CI outright once dev.db stopped being
// committed). Render per request instead.
export const dynamic = "force-dynamic";

export default async function ItinerariesPage() {
  const actor = await getActor();
  if (!actor) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-16 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">已儲存的行程</h1>
          <p className="mt-4 text-zinc-500 dark:text-zinc-400">請先用右上角的「用 Google 登入」，才能看到你儲存的行程。</p>
        </div>
      </div>
    );
  }

  // Only the signed-in user's own itineraries (plan/access-control.md §6).
  const itineraries = await prisma.itinerary.findMany({
    // Expired guest itineraries are already unopenable; don't list them either.
    where: { userId: actor.userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
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

        <ItineraryList itineraries={itineraries.map((item) => ({
          id: item.id,
          title: item.title,
          createdAt: item.createdAt.toISOString(),
          config: item.config,
        }))} />
      </div>
    </div>
  );
}

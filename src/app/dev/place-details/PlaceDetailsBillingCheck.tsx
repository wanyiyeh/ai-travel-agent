"use client";

import { useState } from "react";
import PlaceDetailsDialog from "@/components/PlaceDetailsDialog";

// 淺草寺, Tokyo: a stable, well-known place ID for the check.
const DEFAULT_PLACE_ID = "ChIJ8T1GpMGOGGARDYGSgpooDWw";

/**
 * Counts what this page did, to compare with the "Places UI Kit" request
 * count in the Cloud console: every "open" creates one element; "re-render"
 * changes state while the dialog stays open and should add nothing.
 */
export default function PlaceDetailsBillingCheck() {
  const [placeId, setPlaceId] = useState(DEFAULT_PLACE_ID);
  const [open, setOpen] = useState(false);
  const [opens, setOpens] = useState(0);
  const [rerenders, setRerenders] = useState(0);

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6 text-sm">
      <h1 className="text-lg font-semibold">Places UI Kit 計費檢查（只在開發環境）</h1>
      <p className="text-zinc-500">每按一次「打開」會用真的 key 建立一個元件並計費。</p>
      <label className="block">
        Place ID
        <input
          value={placeId}
          onChange={(e) => setPlaceId(e.target.value.trim())}
          className="mt-1 w-full rounded border px-2 py-1 font-mono dark:bg-zinc-900"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpens((n) => n + 1);
            setOpen(true);
          }}
          className="rounded bg-indigo-600 px-3 py-1.5 text-white"
        >
          打開
        </button>
      </div>
      <p>
        已打開 {opens} 次；開著時重新渲染 {rerenders} 次。
      </p>
      {open && (
        <>
          <PlaceDetailsDialog key={opens} placeId={placeId} onClose={() => setOpen(false)} />
          <button
            type="button"
            onClick={() => setRerenders((n) => n + 1)}
            className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded bg-amber-500 px-3 py-1.5 text-white shadow"
          >
            重新渲染（{rerenders}）
          </button>
        </>
      )}
    </div>
  );
}

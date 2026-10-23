"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { APIProvider, useMapsLibrary } from "@vis.gl/react-google-maps";

/**
 * A place's photos, rating, hours and reviews, drawn by Google's Places UI Kit
 * Place Details element (ADR-0005). The element shows Google's attribution
 * and each photo's author and source link itself, which is what lets the
 * small thumbnails elsewhere go without them (Places API policies).
 *
 * Billed once per element created, whatever it shows. One dialog creates one
 * element and keeps it for as long as it's open, so a re-render doesn't add
 * another; opening a different place opens a new dialog.
 *
 * Mock place IDs (MOCK_PLACES, src/lib/mockPlaces.ts) aren't real places: the
 * element isn't loaded for them, so mock mode stays free.
 */

const MOCK_PLACE_ID_PREFIX = "mock-";

export function isMockPlaceId(placeId: string): boolean {
  return placeId.startsWith(MOCK_PLACE_ID_PREFIX);
}

function PlaceDetailsElement({ placeId }: { placeId: string }) {
  // Registers the gmp-place-* custom elements.
  const places = useMapsLibrary("places");
  if (!places) return <p className="p-4 text-sm text-zinc-400 dark:text-zinc-500">載入中…</p>;
  return (
    <gmp-place-details>
      <gmp-place-details-place-request place={placeId}></gmp-place-details-place-request>
      <gmp-place-all-content></gmp-place-all-content>
    </gmp-place-details>
  );
}

export default function PlaceDetailsDialog({ placeId, onClose }: { placeId: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="地點詳情"
      data-print-hidden
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      // A portal still bubbles through the React tree: keep clicks in here
      // from reaching the card or row that opened it.
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          className="absolute right-2 top-2 z-10 rounded-full bg-white/90 px-2 py-0.5 text-zinc-500 hover:text-zinc-900 dark:bg-zinc-800/90 dark:hover:text-zinc-100"
        >
          ✕
        </button>
        {isMockPlaceId(placeId) ? (
          <p className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
            模擬模式的地點不是真的 Google 地點，這裡不載入地點詳情（避免計費）。
          </p>
        ) : (
          <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!} language="zh-TW">
            <PlaceDetailsElement placeId={placeId} />
          </APIProvider>
        )}
      </div>
    </div>,
    document.body,
  );
}

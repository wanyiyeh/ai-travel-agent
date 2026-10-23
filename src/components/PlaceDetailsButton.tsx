"use client";

import { useState } from "react";
import PlaceDetailsDialog from "@/components/PlaceDetailsDialog";

/**
 * Opens a place's photos, hours and reviews (PlaceDetailsDialog, Places UI
 * Kit) from a saved itinerary, where no thumbnail can lead there: photo
 * names aren't stored (ADR-0004), so the list has no photos to click (#258).
 * Billed once per open, like the thumbnail's dialog.
 *
 * Kept in the read-only public view (data-readonly-keep), left off the PDF.
 */
export function PlaceDetailsButton({ placeId, className = "" }: { placeId?: string | null; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!placeId) return null;
  return (
    <>
      <button
        type="button"
        data-print-hidden
        data-readonly-keep
        // A stop row is draggable; a click here shouldn't start a drag.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors ${className}`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h3l2-3h8l2 3h3v13H3V7z" />
          <circle cx="12" cy="13" r="3.5" strokeWidth={2} />
        </svg>
        照片與詳情
      </button>
      {open && <PlaceDetailsDialog placeId={placeId} onClose={() => setOpen(false)} />}
    </>
  );
}

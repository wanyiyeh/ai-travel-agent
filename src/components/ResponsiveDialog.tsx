"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Modal shell shared by the itinerary page's dialogs. On a phone it is a
 * bottom sheet that fills the width and scrolls inside itself, so the close
 * button and the first lines stay reachable with one thumb; from `sm` up it
 * is the centered card the desktop layout has always used.
 *
 * Rendered through a portal; a portal still bubbles React events through the
 * tree, so clicks inside are stopped from reaching whatever opened it.
 */
export default function ResponsiveDialog({
  label,
  onClose,
  children,
  panelClassName = "sm:max-w-md",
  align = "center",
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Width (and anything else) of the panel from `sm` up. */
  panelClassName?: string;
  /** Desktop vertical placement; tall content reads better from the top. */
  align?: "center" | "top";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Keep the page behind from scrolling along with the sheet.
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-print-hidden
      className={`fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:p-4 ${
        align === "top" ? "sm:items-start sm:py-10" : "sm:items-center"
      }`}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`relative w-full max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-white shadow-xl pb-[env(safe-area-inset-bottom)] dark:bg-zinc-900 sm:max-h-[85vh] sm:rounded-xl sm:pb-0 ${panelClassName}`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          className="sticky top-0 z-10 float-right m-1 flex h-11 w-11 items-center justify-center rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 sm:h-8 sm:w-8"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 dark:bg-zinc-800/90">✕</span>
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

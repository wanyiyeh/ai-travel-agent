"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type MoreMenuItem =
  | { key: string; label: string; onSelect: () => void; disabled?: boolean }
  | { key: string; label: string; href: string };

/**
 * "⋯" button that drops down a list of secondary actions. Used where a row of
 * text links fits a desktop header but not a phone's width. No UI library:
 * closes on outside tap, Escape, or after choosing an item.
 */
export default function MoreMenu({ items, label = "更多" }: { items: MoreMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  const itemClass =
    "block w-full px-4 py-3 text-left text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-xl leading-none text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-30 min-w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {items.map((item) =>
            "href" in item ? (
              <Link key={item.key} role="menuitem" href={item.href} className={itemClass} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ) : (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={itemClass}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

interface InlinePriceEditorProps {
  value?: number;
  currency?: string;
  suffix?: string;
  emptyLabel?: string;
  onSave: (value: number | undefined) => Promise<void>;
}

// A click-to-edit price display shared by the accommodation and meal cards —
// both replace their whole record via a `select` API on save, so the
// onSave callback owns the actual persistence; this component only owns the
// text-vs-input toggle and basic input validation.
export function InlinePriceEditor({
  value,
  currency,
  suffix = "",
  emptyLabel = "+ 設定價格",
  onSave,
}: InlinePriceEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(value !== undefined ? String(value) : "");
    setEditing(true);
  };

  const handleSave = async () => {
    const trimmed = draft.trim();
    const parsed = trimmed === "" ? undefined : Number(trimmed);
    if (parsed !== undefined && (Number.isNaN(parsed) || parsed < 0)) return;

    setSaving(true);
    try {
      await onSave(parsed);
      setEditing(false);
    } catch {
      // parent surfaces the error via the shared error banner; keep the
      // input open so the user's edit isn't lost.
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {currency && <span className="text-xs text-zinc-400 dark:text-zinc-500">{currency}</span>}
        <input
          type="number"
          min={0}
          step="any"
          autoFocus
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-20 px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
          title="儲存"
        >
          ✓
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-50"
          title="取消"
        >
          ✕
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        startEdit();
      }}
      className="text-xs text-emerald-600 dark:text-emerald-400 font-medium hover:underline decoration-dotted underline-offset-2"
      title="點擊手動調整價格"
    >
      {value !== undefined
        ? value === 0
          ? "免費"
          : `💴 ${[currency, value.toLocaleString()].filter(Boolean).join(" ")}${suffix}`
        : emptyLabel}
    </button>
  );
}

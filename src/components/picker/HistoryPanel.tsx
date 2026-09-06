import type { ReactNode } from "react";
import { ACCENT_STYLES, type Accent } from "@/components/picker/accent";
import type { useCandidateHistory } from "@/components/picker/useCandidateHistory";

const formatBatchTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

interface HistoryPanelProps<T> {
  accent: Accent;
  history: ReturnType<typeof useCandidateHistory<T>>;
  renderCandidate: (candidate: T, key: string) => ReactNode;
}

/** The toggle button to place next to a picker's "取消" button. */
export function HistoryToggleButton<T>({
  history,
  disabled,
}: {
  history: ReturnType<typeof useCandidateHistory<T>>;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={history.toggleHistory}
      disabled={disabled}
      className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50 transition-colors"
    >
      {history.showHistory ? "隱藏歷史候選" : "查看歷史候選"}
    </button>
  );
}

/** The expanded batch list, rendered below a picker's button row when `showHistory` is true. */
export function HistoryPanel<T>({ accent, history, renderCandidate }: HistoryPanelProps<T>) {
  if (!history.showHistory) return null;
  const styles = ACCENT_STYLES[accent];

  return (
    <div className={`space-y-3 border-t pt-3 ${styles.historyBorder}`}>
      {history.loading && <p className="text-sm text-zinc-400 dark:text-zinc-500">載入歷史候選中…</p>}
      {history.error && <p className="text-sm text-red-600 dark:text-red-400">{history.error}</p>}
      {!history.loading && !history.error && history.batches?.length === 0 && (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">還沒有更早的查詢紀錄。</p>
      )}
      {history.batches?.map((batch) => {
        const expanded = history.expandedIds.has(batch.id);
        return (
          <div key={batch.id} className="space-y-1.5">
            <button
              type="button"
              onClick={() => history.toggleBatch(batch.id)}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              <svg
                className={`w-3 h-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              {formatBatchTime(batch.createdAt)}（{batch.candidates.length} 筆）
            </button>
            {expanded && (
              <div className="space-y-2">
                {batch.candidates.map((c, i) => renderCandidate(c, `hist-${batch.id}-${i}`))}
              </div>
            )}
          </div>
        );
      })}
      {history.nextCursor && (
        <button
          type="button"
          onClick={history.loadMore}
          disabled={history.loadingMore}
          className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50 transition-colors"
        >
          {history.loadingMore ? "載入中…" : "載入更多歷史"}
        </button>
      )}
    </div>
  );
}

"use client";

import { FIXED_EVENT_TYPES } from "@/lib/fixedEvents";
import { FIXED_EVENT_TYPE_VALUES, FixedEventSchema, type FixedEvent, type FixedEventType } from "@/lib/schemas";

// 固定行程 (plan/form-preference-wiring.md 1.11): what the traveler already
// booked. Rows are kept as typed strings and only turned into FixedEvents on
// submit, so a half-filled row doesn't jump around while typing.

export type FixedEventDraft = {
  type: FixedEventType;
  date: string;
  startTime: string;
  endTime: string;
  venueName: string;
};

export const MAX_FIXED_EVENTS = 10;

export function emptyDraft(date: string): FixedEventDraft {
  return { type: "concert", date, startTime: "", endTime: "", venueName: "" };
}

export function toFixedEvent(draft: FixedEventDraft): FixedEvent {
  return {
    type: draft.type,
    date: draft.date,
    startTime: draft.startTime,
    ...(draft.endTime ? { endTime: draft.endTime } : {}),
    ...(draft.venueName.trim() ? { venueName: draft.venueName.trim() } : {}),
  };
}

/** What's wrong with a row, or undefined when it can be sent. */
export function draftProblem(draft: FixedEventDraft, tripStart: string, tripEnd: string): string | undefined {
  if (!draft.date || !draft.startTime) return "請填日期和開始時間";
  if (draft.date < tripStart || draft.date > tripEnd) return "日期要在旅程期間內";
  const parsed = FixedEventSchema.safeParse(toFixedEvent(draft));
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

const INPUT_CLASS =
  "rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100";

export function FixedEventsEditor({
  drafts,
  onChange,
  tripStart,
  tripEnd,
}: {
  drafts: FixedEventDraft[];
  onChange: (drafts: FixedEventDraft[]) => void;
  tripStart: string;
  tripEnd: string;
}) {
  const update = (index: number, patch: Partial<FixedEventDraft>) =>
    onChange(drafts.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  return (
    <div className="space-y-2">
      {drafts.map((draft, index) => {
        const problem = draftProblem(draft, tripStart, tripEnd);
        const isWork = draft.type === "work";
        return (
          <div key={index} className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="類型"
                value={draft.type}
                onChange={(e) => update(index, { type: e.target.value as FixedEventType })}
                className={INPUT_CLASS}
              >
                {FIXED_EVENT_TYPE_VALUES.map((type) => (
                  <option key={type} value={type}>
                    {FIXED_EVENT_TYPES[type].label}
                  </option>
                ))}
              </select>
              <input
                type="date"
                aria-label="日期"
                value={draft.date}
                min={tripStart}
                max={tripEnd}
                onChange={(e) => update(index, { date: e.target.value })}
                className={INPUT_CLASS}
              />
              <input
                type="time"
                aria-label="開始時間"
                value={draft.startTime}
                onChange={(e) => update(index, { startTime: e.target.value })}
                className={INPUT_CLASS}
              />
              <span className="text-xs text-zinc-400">～</span>
              <input
                type="time"
                aria-label={isWork ? "結束時間" : "結束時間（選填）"}
                title={isWork ? undefined : `沒填時預設 ${FIXED_EVENT_TYPES[draft.type].defaultMinutes / 60} 小時`}
                value={draft.endTime}
                onChange={(e) => update(index, { endTime: e.target.value })}
                className={INPUT_CLASS}
              />
              <button
                type="button"
                onClick={() => onChange(drafts.filter((_, i) => i !== index))}
                className="ml-auto text-xs text-zinc-400 hover:text-red-500 transition-colors"
              >
                刪除
              </button>
            </div>
            <input
              type="text"
              aria-label="地點"
              value={draft.venueName}
              maxLength={200}
              onChange={(e) => update(index, { venueName: e.target.value })}
              placeholder={isWork ? "地點（選填，沒填就在住宿工作）" : "地點，例：東京巨蛋、すきやばし次郎"}
              className={`${INPUT_CLASS} w-full`}
            />
            {problem && <p className="text-xs text-red-600 dark:text-red-400">{problem}</p>}
          </div>
        );
      })}
      {drafts.length < MAX_FIXED_EVENTS && (
        <button
          type="button"
          onClick={() => onChange([...drafts, emptyDraft(tripStart)])}
          disabled={!tripStart}
          className="text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400 disabled:text-zinc-300 transition-colors"
        >
          ＋加入固定行程
        </button>
      )}
      {drafts.length === 0 && (
        <p className="text-xs text-zinc-400">演唱會、球賽、表演、餐廳訂位或工作，時間會固定下來，其他行程繞著它排</p>
      )}
    </div>
  );
}

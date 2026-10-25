import { describe, expect, it } from "vitest";
import type { SkeletonStop } from "@/lib/scheduler/buildDaySkeleton";
import { buildStopCopy, LAST_STOP_NOTE, themeStartNote } from "@/lib/skeletonCopy";

const stop = (id: string): SkeletonStop =>
  ({ id, lat: 35.71, lng: 139.79, time_of_day: "morning", estimatedDurationMinutes: 60, startMinute: 540, endMinute: 600 }) as SkeletonStop;

describe("buildStopCopy", () => {
  it("gives an empty day no lines", () => {
    expect(buildStopCopy([], { themeLabel: "文化巡禮", markLast: true })).toEqual({});
  });

  it("leaves every stop without a line by default", () => {
    expect(buildStopCopy([stop("a"), stop("b")])).toEqual({});
  });

  it("starts a themed day on its first stop and marks the last one", () => {
    expect(buildStopCopy([stop("a"), stop("b"), stop("c")], { themeLabel: "文化巡禮", markLast: true })).toEqual({
      a: themeStartNote("文化巡禮"),
      c: LAST_STOP_NOTE,
    });
    expect(themeStartNote("文化巡禮")).toBe("今天的文化巡禮從這裡開始。");
  });

  it("doesn't call a day's only stop its last", () => {
    expect(buildStopCopy([stop("a")], { markLast: true })).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import type { Day } from "@/types/itinerary";
import { describeProposal, isInputMethodKey, placeIdOf, shownNamesOf, stepSentHistory, stopLabel, transportCard, withStopNames } from "@/lib/chat/display";

const days = [
  {
    id: "d1",
    day: 1,
    stops: [
      { id: "s1", name: "淺草寺", placeId: "p1", description: "", duration_minutes: 60 },
      { id: "s2", name: "", placeId: "p2", description: "", duration_minutes: 60, transport_from_prev: "步行約 10 分鐘" },
    ],
    meals: { dinner: { name: "一蘭" } },
    accommodation: { name: "上野飯店", area: "上野" },
  },
  { id: "d2", day: 2, stops: [] },
] as unknown as Day[];

describe("chat display", () => {
  it("labels stops with the names the page shows, and without when it has none", () => {
    expect(stopLabel(days, { dayId: "d1", stopId: "s1" })).toBe("第1天第1站「淺草寺」");
    expect(stopLabel(days, { dayId: "d1", stopId: "s2" })).toBe("第1天第2站");
    expect(stopLabel(days, { dayId: "d1", stopId: "gone" })).toBe("已經不在行程裡的景點");
    // A card whose stop it removed still says which one it was.
    expect(describeProposal({ action: "remove_stop", params: { dayId: "d1", stopId: "gone", at: "第1天第3站" } }, days)).toBe(
      "刪除第1天第3站",
    );
  });

  it("adds names after the positions a reply mentions", () => {
    expect(withStopNames("第1天第1站在上午，第1天第2站和第3天第1站之後", days)).toBe(
      "第1天第1站（淺草寺）在上午，第1天第2站和第3天第1站之後",
    );
  });

  it("collects the names on screen with what they point at", () => {
    expect(shownNamesOf(days)).toEqual([
      { ref: { kind: "stop", stopId: "s1" }, name: "淺草寺" },
      { ref: { kind: "meal", dayId: "d1", mealType: "dinner" }, name: "一蘭" },
      { ref: { kind: "accommodation", dayId: "d1" }, name: "上野飯店" },
    ]);
  });

  it("says what each card will do", () => {
    const say = (action: string, params: unknown) => describeProposal({ action, params }, days);
    expect(say("remove_stop", { dayId: "d1", stopId: "s1" })).toBe("刪除第1天第1站「淺草寺」");
    expect(say("move_stop", { dayId: "d1", stopId: "s1", toIndex: 1 })).toBe("把第1天第1站「淺草寺」移到第 2 站");
    expect(say("replace_meal", { dayId: "d1", mealType: "dinner", request: "拉麵" })).toBe("換掉第1天的晚餐「一蘭」，找「拉麵」（從候選清單挑）");
    expect(say("restore_meal", { dayId: "d2", mealType: "snack" })).toBe("加回第2天的點心");
    expect(say("restructure", { cities: [{ name: "東京", days: 3, isNew: false }, { name: "名古屋", days: 2, isNew: true }] })).toBe(
      "調整城市：東京 3 天 → 名古屋 2 天（新）",
    );
  });

  it("shows the stored transport line between two stops", () => {
    expect(transportCard(days, { dayId: "d1", stopId: "s2" })).toEqual({
      title: "第1天：第1站「淺草寺」 → 第2站",
      text: "步行約 10 分鐘",
    });
    expect(transportCard(days, { dayId: "d1", stopId: "s1" })).toBeNull();
    expect(placeIdOf(days, { dayId: "d1", stopId: "s2" })).toBe("p2");
  });
});

describe("stepSentHistory", () => {
  const sent = ["想吃拉麵", "換掉住宿", "刪掉午餐"];

  it("goes back from the newest, stopping at the oldest", () => {
    expect(stepSentHistory(sent, null, "up")).toEqual({ at: 2, text: "刪掉午餐" });
    expect(stepSentHistory(sent, 2, "up")).toEqual({ at: 1, text: "換掉住宿" });
    expect(stepSentHistory(sent, 0, "up")).toEqual({ at: 0, text: "想吃拉麵" });
  });

  it("comes forward, and past the newest back to an empty box", () => {
    expect(stepSentHistory(sent, 1, "down")).toEqual({ at: 2, text: "刪掉午餐" });
    expect(stepSentHistory(sent, 2, "down")).toEqual({ at: null, text: "" });
  });

  it("does nothing with nothing sent, or down from the owner's own draft", () => {
    expect(stepSentHistory([], null, "up")).toBeNull();
    expect(stepSentHistory(sent, null, "down")).toBeNull();
  });
});

describe("isInputMethodKey", () => {
  const idle = { composing: false, msSinceCompositionEnd: Infinity };

  it("leaves keys the input method is using to it", () => {
    // Chrome on Windows can send the Enter that picks a 注音 character with
    // isComposing false, but with keyCode 229.
    expect(isInputMethodKey({ isComposing: false, keyCode: 229 }, idle)).toBe(true);
    expect(isInputMethodKey({ isComposing: true, keyCode: 13 }, idle)).toBe(true);
    expect(isInputMethodKey({ isComposing: false, keyCode: 13 }, { ...idle, composing: true })).toBe(true);
  });

  it("leaves the Enter sent right after the composition ended to it", () => {
    // Microsoft 注音 ends the composition, then sends a plain Enter.
    expect(isInputMethodKey({ isComposing: false, keyCode: 13 }, { composing: false, msSinceCompositionEnd: 5 })).toBe(true);
  });

  it("lets a plain Enter send", () => {
    expect(isInputMethodKey({ isComposing: false, keyCode: 13 }, idle)).toBe(false);
    expect(isInputMethodKey({ isComposing: false, keyCode: 13 }, { composing: false, msSinceCompositionEnd: 1500 })).toBe(false);
  });
});

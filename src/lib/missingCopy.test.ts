import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
vi.mock("@/lib/openai", () => ({
  openai: { chat: { completions: { create: (...args: unknown[]) => createMock(...args) } } },
}));

const { collectCopyTargets, fillMissingCopy, needsCopy, withCopy } = await import("@/lib/missingCopy");

const aiReturns = (copy: Record<string, string>) =>
  createMock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ copy }) } }] });

// A 鎌倉 day trip: the program's stops carry travel notes only; lunch near
// the first sight says why it's there; the coffee rotated in has nothing.
const tripDays = () => [
  {
    waypointCity: "東京",
    stops: [
      { name: "鶴岡八幡宮", placeId: "p1", description: "一日遊：從東京搭火車約 1 小時到鎌倉", copyPending: true },
      { name: "鎌倉大佛殿高德院", placeId: "p2", description: "", copyPending: true },
      { name: "長谷寺", placeId: "p3", description: "長谷寺以四季花卉聞名。" },
    ],
    meals: {
      lunch: { name: "Umizoi no kikori shokudo", placeId: "m1", description: "在鎌倉吃午餐", copyPending: true },
      snack: { name: "Bear Pond Espresso", placeId: "m2" },
      dinner: { name: "叙々苑", placeId: "m3", description: "已訂位 18:00～19:30", fixedEvent: { type: "reservation" } },
    },
  },
];

beforeEach(() => {
  createMock.mockReset();
});

describe("needsCopy", () => {
  it("picks real places with nothing written, or only the program's note", () => {
    expect(needsCopy({ name: "Cafe", placeId: "x" })).toBe(true);
    expect(needsCopy({ name: "Cafe", placeId: "x", description: " " })).toBe(true);
    expect(needsCopy({ name: "Shrine", placeId: "x", description: "傍晚搭火車回東京", copyPending: true })).toBe(true);
    expect(needsCopy({ name: "Shrine", placeId: "x", description: "Already written." })).toBe(false);
  });

  it("leaves bookings, car pickups and placeless steps alone", () => {
    expect(needsCopy({ name: "叙々苑", placeId: "x", fixedEvent: { type: "reservation" } })).toBe(false);
    expect(needsCopy({ name: "搭乘JR前往小樽" })).toBe(false);
  });
});

describe("collectCopyTargets", () => {
  it("collects stops and meals, labeled for the model", () => {
    const targets = collectCopyTargets(tripDays());
    expect(targets.map((t) => [t.kind, t.item.name])).toEqual([
      ["景點", "鶴岡八幡宮"],
      ["景點", "鎌倉大佛殿高德院"],
      ["午餐", "Umizoi no kikori shokudo"],
      ["點心", "Bear Pond Espresso"],
    ]);
  });
});

describe("withCopy", () => {
  it("puts the model's line before the program's note", () => {
    expect(withCopy("鎌倉的象徵，祭祀源氏的守護神。", "一日遊：從東京搭火車約 1 小時到鎌倉")).toBe(
      "鎌倉的象徵，祭祀源氏的守護神。一日遊：從東京搭火車約 1 小時到鎌倉"
    );
    expect(withCopy("露天的巨大青銅佛像", "")).toBe("露天的巨大青銅佛像。");
  });
});

describe("fillMissingCopy", () => {
  it("writes every missing line in one call and drops the marks", async () => {
    aiReturns({ 0: "鎌倉的象徵", 1: "露天的巨大青銅佛像", 2: "面海的小食堂", 3: "手沖咖啡名店" });
    const days = tripDays();

    await fillMissingCopy(days, "m");

    expect(createMock).toHaveBeenCalledTimes(1);
    const [stop0, stop1, stop2] = days[0].stops;
    expect(stop0.description).toBe("鎌倉的象徵。一日遊：從東京搭火車約 1 小時到鎌倉");
    expect(stop1.description).toBe("露天的巨大青銅佛像。");
    expect(stop2.description).toBe("長谷寺以四季花卉聞名。");
    expect(days[0].meals.lunch.description).toBe("面海的小食堂。在鎌倉吃午餐");
    expect((days[0].meals.snack as { description?: string }).description).toBe("手沖咖啡名店。");
    expect(days[0].meals.dinner.description).toBe("已訂位 18:00～19:30");
    expect(JSON.stringify(days)).not.toContain("copyPending");
    const userMessage = createMock.mock.calls[0][0].messages[1].content as string;
    expect(userMessage.split("\n")[0]).toBe("0｜景點｜東京｜鶴岡八幡宮");
  });

  it("keeps what each place had when the call fails, still dropping the marks", async () => {
    createMock.mockRejectedValueOnce(new Error("timeout"));
    const days = tripDays();

    await fillMissingCopy(days, "m");

    expect(days[0].stops[0].description).toBe("一日遊：從東京搭火車約 1 小時到鎌倉");
    expect(JSON.stringify(days)).not.toContain("copyPending");
  });

  it("makes no call when everything already has a description", async () => {
    await fillMissingCopy([{ stops: [{ name: "長谷寺", placeId: "p3", description: "寫好了。" }], meals: {} }], "m");
    expect(createMock).not.toHaveBeenCalled();
  });
});

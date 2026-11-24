import { describe, expect, it } from "vitest";
import { googleName, expectNoGoogleContent } from "@tests/contracts/googleContent";
import { labelOf, replaceShownNames, tripCities, tripSummary } from "@/lib/chat/context";

const days = [
  {
    id: "d1",
    waypointCity: "東京",
    stops: [
      { id: "s1", placeId: "p1", name: googleName("淺草寺"), description: googleName("古寺"), time_of_day: "morning", duration_minutes: 60, transport_from_prev: "步行約 10 分鐘" },
      { id: "s2", placeId: "p2", name: googleName("晴空塔"), time_of_day: "afternoon", duration_minutes: 90 },
    ],
    meals: { lunch: { placeId: "m1", name: googleName("一蘭") }, dinner: { placeId: "m2", name: googleName("鳥貴族") } },
    skippedMeals: ["snack"],
    accommodation: { placeId: "h1", name: googleName("飯店") },
    weatherNote: "日落約 16:30",
  },
  {
    id: "d2",
    waypointCity: "東京",
    isTransitDay: true,
    transitTo: "京都",
    stops: [
      { id: "s3", kind: "transit", name: "搭乘新幹線前往京都", duration_minutes: 140 },
      { id: "s4", placeId: "p1", name: googleName("淺草寺"), duration_minutes: 30 },
    ],
  },
];

describe("tripSummary", () => {
  const summary = tripSummary(days, "2026-12-01");

  it("keeps Google content out (ADR-0008)", () => {
    expectNoGoogleContent(summary);
    expect(summary).not.toContain("步行約 10 分鐘"); // a Routes time
  });

  it("gives dates, cities, slots, stays and the traveler-visible structure", () => {
    expect(summary).toContain("第1天（2026-12-01，東京）");
    expect(summary).toContain("第2天（2026-12-02，東京，移動日，前往京都）");
    expect(summary).toContain("第1站，上午，停留約 60 分鐘");
    expect(summary).toContain("已排餐點：午餐、晚餐；旅客刪掉的餐點：點心；有住宿");
    expect(summary).toContain("天氣：日落約 16:30");
  });

  it("names a transit ride, which is our own text", () => {
    expect(summary).toContain("第1站，停留約 140 分鐘，城市間交通：搭乘新幹線前往京都");
  });

  it("leaves dates out when the trip has none", () => {
    expect(tripSummary(days, "")).toContain("第1天（東京）");
  });
});

describe("tripCities", () => {
  it("lists the route's cities once, in order", () => {
    expect(tripCities(days)).toEqual(["東京", "京都"]);
  });
});

describe("labelOf", () => {
  it("places stops, meals and lodging, and rejects what the trip doesn't have", () => {
    expect(labelOf(days, { kind: "stop", stopId: "s2" })).toBe("第1天第2站");
    expect(labelOf(days, { kind: "meal", dayId: "d1", mealType: "dinner" })).toBe("第1天的晚餐");
    expect(labelOf(days, { kind: "accommodation", dayId: "d1" })).toBe("第1天的住宿");
    expect(labelOf(days, { kind: "stop", stopId: "nope" })).toBeNull();
    expect(labelOf(days, { kind: "meal", dayId: "d1", mealType: "breakfast" })).toBeNull();
    expect(labelOf(days, { kind: "accommodation", dayId: "d2" })).toBeNull();
  });
});

describe("replaceShownNames", () => {
  const shown = [
    { ref: { kind: "stop" as const, stopId: "s1" }, name: googleName("淺草寺") },
    { ref: { kind: "stop" as const, stopId: "s4" }, name: googleName("淺草寺") },
    { ref: { kind: "stop" as const, stopId: "s2" }, name: googleName("晴空塔") },
    { ref: { kind: "meal" as const, dayId: "d1", mealType: "dinner" as const }, name: "Torikizoku" },
  ];

  it("swaps a typed name for where it sits, so no Google name reaches the model", () => {
    const text = replaceShownNames(`把${googleName("晴空塔")}移到上午`, days, shown);
    expect(text).toBe("把「第1天第2站」移到上午");
    expectNoGoogleContent(text);
  });

  it("lists every place a repeated name could mean", () => {
    expect(replaceShownNames(`不要去${googleName("淺草寺")}`, days, shown)).toBe("不要去「第1天第1站或第2天第2站」");
  });

  it("ignores case and full-width forms but keeps the rest of the message as typed", () => {
    expect(replaceShownNames("ＴＯＲＩＫＩＺＯＫＵ 換掉 OK", days, shown)).toBe("「第1天的晚餐」 換掉 OK");
    expect(replaceShownNames("好，torikizoku（晚上）換掉！", days, shown)).toBe("好，「第1天的晚餐」（晚上）換掉！");
  });

  it("tries longer names first", () => {
    const nested = [
      { ref: { kind: "stop" as const, stopId: "s1" }, name: "淺草寺" },
      { ref: { kind: "stop" as const, stopId: "s2" }, name: "淺草" },
    ];
    expect(replaceShownNames("淺草寺和淺草", days, nested)).toBe("「第1天第1站」和「第1天第2站」");
  });

  it("skips names the trip doesn't have and one-character names", () => {
    const odd = [
      { ref: { kind: "stop" as const, stopId: "gone" }, name: "清水寺" },
      { ref: { kind: "stop" as const, stopId: "s1" }, name: "寺" },
    ];
    expect(replaceShownNames("清水寺的寺", days, odd)).toBe("清水寺的寺");
  });
});

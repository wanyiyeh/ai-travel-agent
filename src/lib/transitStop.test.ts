import { describe, expect, it } from "vitest";
import { isTransitStop, transitStopIndex, withoutZeroFare } from "./transitStop";

describe("withoutZeroFare", () => {
  it("drops a fare of 0 so the ride reads as not estimated (#313)", () => {
    expect(withoutZeroFare({ name: "搭乘長途巴士前往阿克雷里", estimated_cost: 0 })).toEqual({
      name: "搭乘長途巴士前往阿克雷里",
    });
  });

  it("drops a fare that is not a number", () => {
    expect(withoutZeroFare({ name: "x", estimated_cost: "免費" })).toEqual({ name: "x" });
  });

  it("keeps a real fare", () => {
    const stop = { name: "x", estimated_cost: 12000 };
    expect(withoutZeroFare(stop)).toBe(stop);
  });
});

const transitDay = { isTransitDay: true };

describe("isTransitStop", () => {
  it("trusts the kind marker on any day", () => {
    expect(isTransitStop({ kind: "transit", name: "Ferry" }, {})).toBe(true);
  });

  it("recognises a legacy ride by shape on a transit day", () => {
    expect(isTransitStop({ name: "搭乘自駕車前往赫曼努斯" }, transitDay)).toBe(true);
    expect(isTransitStop({ name: "從南竿前往北竿" }, transitDay)).toBe(true);
  });

  it("leaves real places, meals and booked events alone", () => {
    expect(isTransitStop({ name: "早餐" }, transitDay)).toBe(false);
    expect(isTransitStop({ name: "前往觀景台", placeId: "p1" }, transitDay)).toBe(false);
    expect(isTransitStop({ name: "前往演唱會", fixedEvent: {} }, transitDay)).toBe(false);
  });

  it("never matches by shape outside a transit day", () => {
    expect(isTransitStop({ name: "搭乘纜車前往山頂" }, { isTransitDay: false })).toBe(false);
    expect(isTransitStop({ name: "搭乘纜車前往山頂" }, {})).toBe(false);
  });
});

describe("transitStopIndex", () => {
  it("finds the ride among the day's stops", () => {
    const stops = [{ name: "早餐" }, { name: "Kraal Rock", placeId: "a" }, { name: "搭乘自駕車前往赫曼努斯" }];
    expect(transitStopIndex(stops, transitDay)).toBe(2);
    expect(transitStopIndex(stops, {})).toBe(-1);
  });
});

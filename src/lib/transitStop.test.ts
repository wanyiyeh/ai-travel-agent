import { describe, expect, it } from "vitest";
import { isTransitStop, transitStopIndex } from "./transitStop";

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

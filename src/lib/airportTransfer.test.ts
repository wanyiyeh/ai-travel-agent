import { describe, expect, it } from "vitest";
import { airportTransferMinutes } from "@/lib/airportTransfer";
import { AIRPORTS } from "@/lib/airports";

describe("airportTransferMinutes", () => {
  it("is about half an hour from 羽田, over an hour from 成田", () => {
    expect(airportTransferMinutes("HND")).toBe(30);
    expect(airportTransferMinutes("NRT")).toBe(75);
  });

  it("is unknown for an airport not in the table, or a place in Taiwan", () => {
    expect(airportTransferMinutes("XXX")).toBeUndefined();
    expect(airportTransferMinutes("TW-TNN")).toBeUndefined();
  });

  it("covers every airport a trip can fly to, Taiwan's own aside", () => {
    const abroad = Object.keys(AIRPORTS).filter((code) => !code.startsWith("TW-") && !["TPE", "KHH", "RMQ"].includes(code));
    expect(abroad.filter((code) => airportTransferMinutes(code) === undefined)).toEqual([]);
  });
});

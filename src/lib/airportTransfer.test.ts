import { describe, expect, it } from "vitest";
import { airportTransferMinutes } from "@/lib/airportTransfer";
import { AIRPORTS } from "@/lib/airports";
import generatedAirports from "@/data/airports.generated.json";

describe("airportTransferMinutes", () => {
  it("is about half an hour from 羽田, over an hour from 成田", () => {
    expect(airportTransferMinutes("HND")).toBe(30);
    expect(airportTransferMinutes("NRT")).toBe(75);
  });

  it("is unknown for a code that isn't an airport, or a place in Taiwan", () => {
    expect(airportTransferMinutes("XXX")).toBeUndefined();
    expect(airportTransferMinutes("TW-TNN")).toBeUndefined();
  });

  // ADR-0011: an airport beyond the table, from its distance to the centre.
  it("estimates an airport beyond the table from how far it is from the city", () => {
    // Lima's airport is about 9 km from the centre: 20 + 9 × 0.9 ≈ 28 → 30
    expect(airportTransferMinutes("LIM")).toBe(30);
  });

  // #306: the old airports were 20–30 minutes out; the new ones are farther.
  it("times Cambodia's new airports from where they are, not the closed ones", () => {
    expect(airportTransferMinutes("SAI")).toBeGreaterThan(airportTransferMinutes("REP")!);
    expect(airportTransferMinutes("KTI")).toBeGreaterThan(airportTransferMinutes("PNH")!);
  });

  it("has a time for every generated airport", () => {
    expect(Object.keys(generatedAirports).filter((code) => airportTransferMinutes(code) === undefined)).toEqual([]);
  });

  it("covers every airport a trip can fly to, Taiwan's own aside", () => {
    const abroad = Object.keys(AIRPORTS).filter((code) => !code.startsWith("TW-") && !["TPE", "KHH", "RMQ"].includes(code));
    expect(abroad.filter((code) => airportTransferMinutes(code) === undefined)).toEqual([]);
  });
});

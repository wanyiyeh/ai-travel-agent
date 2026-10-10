import { describe, expect, it } from "vitest";
import type { FlightInfo } from "@/lib/schemas";
import { domesticJourneyEvents, journey, routeDescription, withDomesticTimes } from "@/lib/domesticTrips";

// Real times for comparison: 台北→台南 高鐵 about 1h45 door to door, 台北→花蓮
// 台鐵 about 2h10-2h30, 台北→台中 高鐵 about 1h, 台北→台南 by car about 4h.
describe("journey", () => {
  it.each([
    ["台北 → 台南, 高鐵", "TW-TPE", "TW-TNN", false, "搭高鐵", 90, 120],
    ["台北 → 台中, 高鐵", "TW-TPE", "TW-TXG", false, "搭高鐵", 50, 75],
    ["台北 → 花蓮, 台鐵", "TW-TPE", "TW-HUN", false, "搭台鐵或客運", 130, 180],
    ["台北 → 台南, 開車", "TW-TPE", "TW-TNN", true, "開車", 200, 260],
    ["台北 → 花蓮, 開車 on the slow coast road", "TW-TPE", "TW-HUN", true, "開車", 150, 200],
  ] as const)("%s", (_name, from, to, selfDrive, how, min, max) => {
    const j = journey(from, to, selfDrive);
    expect(j.how).toBe(how);
    expect(j.minutes).toBeGreaterThanOrEqual(min);
    expect(j.minutes).toBeLessThanOrEqual(max);
  });

  it("goes to a mountain town by rail to its hub, then the bus — either way round", () => {
    const there = journey("TW-TPE", "TW-SML", false);
    expect(there.how).toBe("搭高鐵到台中，再轉客運");
    expect(journey("TW-SML", "TW-TPE", false).minutes).toBe(there.minutes);
  });

  it("flies to an island when that's quickest, counting check-in", () => {
    const j = journey("TW-KHH", "TW-PEH", false);
    expect(j.how).toBe("搭飛機");
    expect(j.minutes).toBe(60 + 40); // 高雄機場 check-in + flight
  });

  it("takes the boat to 綠島, after the way to 台東", () => {
    const j = journey("TW-TPE", "TW-GDI", false);
    expect(j.how).toBe("搭台鐵或客運到台東富岡漁港，搭船");
  });

  it("is nothing from a place to itself", () => {
    expect(journey("TW-TNN", "TW-TNN", false).minutes).toBe(0);
  });
});

const trip: FlightInfo = {
  tripType: "domestic",
  departureCity: "TW-TPE",
  arrivalCity: "TW-TNN",
  returnDepartureCity: "TW-TNN",
  departureDate: "2026-11-10",
  returnDate: "2026-11-12",
  homeDepartureTime: "08:00",
  homeArrivalTime: "20:00",
};

describe("withDomesticTimes", () => {
  it("works out arriving and leaving from the times at home", () => {
    const filled = withDomesticTimes(trip, false);
    const out = journey("TW-TPE", "TW-TNN", false).minutes;
    expect(filled.arrivalTime).toBe(`${String(8 + Math.floor(out / 60)).padStart(2, "0")}:${String(out % 60).padStart(2, "0")}`);
    expect(filled.returnDepartureTime! < "20:00").toBe(true);
  });

  it("leaves a trip abroad as it was", () => {
    const abroad: FlightInfo = { ...trip, tripType: undefined, departureCity: "TPE", arrivalCity: "NRT", returnDepartureCity: "NRT" };
    expect(withDomesticTimes(abroad, false)).toBe(abroad);
  });
});

describe("domesticJourneyEvents", () => {
  it("blocks the way there and home, pinned like a booking", () => {
    const { outbound, homebound } = domesticJourneyEvents(trip, false);
    expect(outbound?.block.startMinute).toBe(8 * 60);
    expect(outbound?.stop?.name).toBe("從台北前往台南");
    expect(outbound?.stop?.description).toMatch(/^搭高鐵約 1 小時 \d+ 分（估計）$/);
    expect(outbound?.stop?.fixedEvent).toBeDefined();
    expect(homebound?.block.endMinute).toBe(20 * 60);
    expect(homebound?.stop?.name).toBe("從台南前往台北");
  });

  it("says to check the boats for an island, and winter seas for 綠島", () => {
    const { outbound } = domesticJourneyEvents({ ...trip, arrivalCity: "TW-GDI", returnDepartureCity: "TW-GDI" }, false);
    expect(outbound?.stop?.description).toContain("出發前確認航班、船班，冬天常因東北季風停航");
  });

  it("has no block without a time", () => {
    expect(domesticJourneyEvents({ ...trip, homeDepartureTime: undefined, homeArrivalTime: undefined }, false)).toEqual({});
  });
});

describe("routeDescription", () => {
  it("describes a domestic trip by towns, not flights", () => {
    expect(routeDescription(trip)).toBe("台灣國內旅遊：從台北出發前往台南，結束後從台南回台北");
    expect(routeDescription({ ...trip, tripType: undefined, arrivalCity: "NRT", returnDepartureCity: "NRT" })).toBe("從台灣出發飛往東京來回");
  });
});

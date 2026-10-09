import { describe, expect, it } from "vitest";
import { carPickup, carReturnStop } from "@/lib/carRental";

const rental = { placeId: "times", name: "Times Car 成田空港店", lat: 35.77, lng: 140.39 };

describe("carPickup", () => {
  it("blocks 45 minutes at the start of day 1 at the rental counter", () => {
    const { block, stop } = carPickup(rental, 10 * 60, { arrivalIata: "NRT", returnIata: "NRT" });
    expect(block).toEqual({ startMinute: 600, endMinute: 645 });
    expect(stop).toMatchObject({ name: "機場取車：Times Car 成田空港店", placeId: "times", fixedEvent: { startTime: "10:00", endTime: "10:45" } });
  });

  it("reminds about the Japanese license translation in Japan, and an international license elsewhere", () => {
    expect(carPickup(rental, 600, { arrivalIata: "NRT", returnIata: "NRT" }).stop?.description).toContain("駕照日文譯本");
    expect(carPickup(rental, 600, { arrivalIata: "ICN", returnIata: "ICN" }).stop?.description).not.toContain("日文譯本");
  });

  it("warns about the one-way fee when the car goes back at another airport", () => {
    expect(carPickup(rental, 600, { arrivalIata: "NRT", returnIata: "KIX" }).stop?.description).toContain("甲租乙還");
    expect(carPickup(rental, 600, { arrivalIata: "NRT", returnIata: "NRT" }).stop?.description).not.toContain("甲租乙還");
  });

  it("still adds the pickup when no rental counter was found", () => {
    expect(carPickup(undefined, 600, { arrivalIata: "NRT", returnIata: "NRT" }).stop).toMatchObject({ name: "機場取車：租車公司" });
  });
});

describe("carReturnStop", () => {
  it("is a 30-minute stop at the given time", () => {
    expect(carReturnStop(rental, 13 * 60)).toMatchObject({ duration_minutes: 30, fixedEvent: { startTime: "13:00", endTime: "13:30" } });
  });
});

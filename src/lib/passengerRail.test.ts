import { describe, expect, it } from "vitest";
import { dayTripTravelFor } from "@/lib/passengerRail";

describe("dayTripTravelFor", () => {
  // #310: Iceland has no trains, but a day trip from 雷克雅維克 said 「搭火車」.
  it("goes by bus out of a city in a country without trains", () => {
    expect(dayTripTravelFor("雷克雅維克", ["KEF"], false)).toBe("bus");
  });

  it("goes by train where there are trains", () => {
    expect(dayTripTravelFor("東京", ["NRT"], false)).toBe("rail");
  });

  it("drives for a traveler with a car, trains or not", () => {
    expect(dayTripTravelFor("雷克雅維克", ["KEF"], true)).toBe("drive");
  });

  it("goes by the trip's airports for a city with no airport of its own", () => {
    // Where a friend's Iceland trip stayed between 雷克雅維克 and 阿克雷里.
    expect(dayTripTravelFor("辛格韋德利", ["KEF", "KEF"], false)).toBe("bus");
    expect(dayTripTravelFor("箱根", ["NRT", "KIX"], false)).toBe("rail");
    expect(dayTripTravelFor("辛格韋德利", ["KEF", "CPH"], false)).toBe("rail");
  });
});

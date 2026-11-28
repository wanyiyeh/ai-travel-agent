import { describe, expect, it } from "vitest";
import type { Day, Stop } from "@/types/itinerary";
import { reusableStopsFor } from "@/lib/reusableStops";

const stop = (id: string, name: string | undefined): Stop =>
  ({ id, name, description: "", duration_minutes: 60, time_of_day: "morning" }) as unknown as Stop;
const day = (n: number, stops: Stop[]): Day =>
  ({ id: `d${n}`, day: n, waypointCity: "首爾", stops }) as unknown as Day;

describe("reusableStopsFor", () => {
  it("offers same-city stops from the other days", () => {
    const days = [day(1, [stop("a", "景福宮")]), day(2, [stop("b", "明洞")])];
    expect(reusableStopsFor(days, days[0], null).map((r) => r.candidate.name)).toEqual(["明洞"]);
  });

  // #376: a day not yet opened has no names filled in; listing those
  // stops crashed the day editor.
  it("skips stops whose name hasn't been filled in", () => {
    const days = [day(1, [stop("a", "景福宮")]), day(2, [stop("b", undefined), stop("c", "明洞")])];
    expect(reusableStopsFor(days, days[0], null).map((r) => r.candidate.name)).toEqual(["明洞"]);
  });
});

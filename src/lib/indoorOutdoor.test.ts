import { describe, expect, it } from "vitest";
import { exposureOf, indoorFirstPool, keepOutdoorOffMidday } from "@/lib/indoorOutdoor";

describe("exposureOf", () => {
  // Types as Google returned them for these Tokyo places (dev.db cache).
  it.each([
    ["東京晴空塔", ["observation_deck", "tourist_attraction"], "indoor"],
    ["teamLab Planets", ["tourist_attraction", "amusement_center", "art_museum"], "indoor"],
    ["東京國立博物館", ["tourist_attraction", "art_museum", "museum"], "indoor"],
    ["新宿御苑", ["garden", "tourist_attraction", "state_park"], "outdoor"],
    ["淺草寺", ["buddhist_temple", "tourist_attraction", "place_of_worship"], "outdoor"],
    ["明治神宮", ["shinto_shrine", "tourist_attraction", "place_of_worship"], "outdoor"],
    ["皇居", ["castle", "tourist_attraction", "historical_place"], "outdoor"],
  ])("%s is %s", (_name, types, expected) => {
    expect(exposureOf(types)).toBe(expected);
  });

  it("leaves a place with nothing to go on undecided", () => {
    expect(exposureOf(["tourist_attraction", "point_of_interest"])).toBeUndefined();
  });
});

describe("keepOutdoorOffMidday", () => {
  const stop = (id: string, outdoor: boolean, groupId?: string) => ({ id, outdoor, groupId });
  const ids = (stops: Array<{ id: string }>) => stops.map((s) => s.id);
  const isOutdoor = (s: { outdoor: boolean }) => s.outdoor;

  it("opens the day with one outdoor stop and closes it with the rest", () => {
    const day = [stop("museum", false), stop("park", true), stop("mall", false), stop("garden", true)];
    expect(ids(keepOutdoorOffMidday(day, isOutdoor, 9 * 60))).toEqual(["park", "museum", "mall", "garden"]);
  });

  it("puts every outdoor stop last when the day starts at midday (a late riser)", () => {
    const day = [stop("park", true), stop("museum", false)];
    expect(ids(keepOutdoorOffMidday(day, isOutdoor, 11 * 60))).toEqual(["museum", "park"]);
  });

  it("keeps a temple and its gate together in the morning", () => {
    const day = [stop("museum", false), stop("temple", true, "t"), stop("gate", true, "t"), stop("park", true)];
    expect(ids(keepOutdoorOffMidday(day, isOutdoor, 9 * 60))).toEqual(["temple", "gate", "museum", "park"]);
  });

  it("leaves a day without outdoor stops as it was", () => {
    const day = [stop("museum", false), stop("mall", false)];
    expect(keepOutdoorOffMidday(day, isOutdoor, 9 * 60)).toBe(day);
  });
});

describe("indoorFirstPool", () => {
  const isOutdoor = (c: { outdoor: boolean }) => c.outdoor;
  const pool = [{ outdoor: true }, { outdoor: false }, { outdoor: false }];

  it("drops outdoor places when the rest still covers the stops needed", () => {
    expect(indoorFirstPool(pool, 2, isOutdoor)).toEqual([{ outdoor: false }, { outdoor: false }]);
  });

  it("keeps outdoor places to fill in when there aren't enough sheltered ones", () => {
    expect(indoorFirstPool(pool, 3, isOutdoor)).toBe(pool);
  });
});

import { describe, expect, it } from "vitest";
import { tripPlaceNames } from "@/lib/tripPlaceNames";

describe("tripPlaceNames", () => {
  // #324: a saved Google place has no name, and its undefined made the request invalid.
  it("leaves out stops saved without a name", () => {
    const days = [
      { stops: [{ placeId: "p-1" }, { placeId: "p-2", name: "" }] },
      { isTransitDay: true, transitTo: "京都", stops: [{ kind: "transit", name: "從 大阪 前往 京都" }] },
      { stops: [{ name: "維利奇卡鹽礦", fixedEvent: { type: "dayTrip" } }, null] },
    ];
    expect(tripPlaceNames(days)).toEqual(["京都", "從 大阪 前往 京都", "維利奇卡鹽礦"]);
  });

  it("is empty for a trip with no days or stops", () => {
    expect(tripPlaceNames([])).toEqual([]);
    expect(tripPlaceNames([{ isTransitDay: true }, { stops: "not a list" }])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { mapPlaceTypeToCategory } from "@/lib/scheduler/mapPlaceTypeToCategory";

describe("mapPlaceTypeToCategory", () => {
  // Real `types` observed for this project's seeded itineraries (see
  // plan/hybrid-rule-engine-scheduling.md section 7).
  it("maps a temple correctly despite generic noise types", () => {
    expect(
      mapPlaceTypeToCategory([
        "buddhist_temple", "tourist_attraction", "place_of_worship",
        "association_or_organization", "point_of_interest", "establishment",
      ])
    ).toBe("temple");
  });

  it("maps a castle with an interior museum tag to museum, not the generic landmark bucket", () => {
    // A castle whose types include "museum" (e.g. São Jorge Castle, Osaka
    // Castle in this project's seed data) has exhibits worth the longer
    // 90min museum duration, not just a 45min landmark photo-stop — museum
    // is deliberately checked before landmark in CATEGORY_PRIORITY for this.
    expect(
      mapPlaceTypeToCategory([
        "castle", "tourist_attraction", "historical_place", "museum",
        "point_of_interest", "establishment",
      ])
    ).toBe("museum");
  });

  it("falls back to landmark for a castle with no museum tag", () => {
    expect(
      mapPlaceTypeToCategory([
        "castle", "tourist_attraction", "historical_place",
        "point_of_interest", "establishment",
      ])
    ).toBe("landmark");
  });

  it("maps an observation deck to viewpoint", () => {
    expect(
      mapPlaceTypeToCategory([
        "observation_deck", "landmark", "tourist_attraction", "shopping_mall",
        "art_gallery", "point_of_interest", "establishment",
      ])
    ).toBe("viewpoint");
  });

  it("maps a dedicated art museum to museum", () => {
    expect(
      mapPlaceTypeToCategory([
        "art_museum", "place_of_worship", "association_or_organization",
        "museum", "point_of_interest", "establishment",
      ])
    ).toBe("museum");
  });

  it("maps a shopping street to shopping", () => {
    expect(
      mapPlaceTypeToCategory(["market", "tourist_attraction", "point_of_interest", "establishment"])
    ).toBe("shopping");
  });

  it("falls back to landmark for a generic tourist attraction with no specific type", () => {
    expect(
      mapPlaceTypeToCategory(["tourist_attraction", "point_of_interest", "establishment"])
    ).toBe("landmark");
  });

  it("returns undefined when nothing recognizable is present", () => {
    expect(mapPlaceTypeToCategory(["route"])).toBeUndefined();
    expect(mapPlaceTypeToCategory([])).toBeUndefined();
  });
});

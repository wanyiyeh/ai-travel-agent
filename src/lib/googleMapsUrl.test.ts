import { describe, expect, it } from "vitest";
import { buildNearbySearchUrl } from "@/lib/googleMapsUrl";

describe("buildNearbySearchUrl", () => {
  it("searches around a point, so no Places call is needed", () => {
    expect(buildNearbySearchUrl("supermarket", 35.69, 139.7)).toBe("https://www.google.com/maps/search/supermarket/@35.69,139.7,16z");
  });
});

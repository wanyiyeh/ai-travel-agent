import { describe, expect, it } from "vitest";
import { mockGoogleResponse } from "@/lib/mockPlaces";
import { isMockPlaceId } from "./PlaceDetailsDialog";

// Mock mode must stay free: the details element is billed per load, so it's
// never loaded for a place MOCK_PLACES made up.
describe("isMockPlaceId", () => {
  it("recognizes the IDs mock mode hands out", async () => {
    const res = mockGoogleResponse("https://places.googleapis.com/v1/places:searchText", {
      body: JSON.stringify({ textQuery: "淺草寺" }),
    });
    const { places } = (await res.json()) as { places: { id: string }[] };
    expect(places.length).toBeGreaterThan(0);
    for (const { id } of places) expect(isMockPlaceId(id)).toBe(true);
  });

  it("doesn't mistake a real place ID for one", () => {
    expect(isMockPlaceId("ChIJ-sensoji")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { isValidPhotoName } from "./placePhotoName";

const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const VALID = `places/${PLACE_ID}/photos/AUc7tXV-abc_123`;

describe("isValidPhotoName", () => {
  it("accepts a real-shaped photo name for the same place", () => {
    expect(isValidPhotoName(VALID, PLACE_ID)).toBe(true);
  });

  it("rejects a photo name belonging to a different place", () => {
    expect(isValidPhotoName(VALID, "ChIJotherPlaceId")).toBe(false);
  });

  it.each([
    ["path traversal", `places/${PLACE_ID}/photos/../../places:searchText`],
    ["query injection", `places/${PLACE_ID}/photos/x?key=attacker`],
    ["extra path segment", `places/${PLACE_ID}/photos/x/media`],
    ["not a photo resource", `places/${PLACE_ID}`],
    ["url-encoded slash", `places/${PLACE_ID}/photos/x%2F..`],
    ["absolute url", `https://evil.example/places/${PLACE_ID}/photos/x`],
    ["empty", ""],
  ])("rejects %s", (_label, name) => {
    expect(isValidPhotoName(name, PLACE_ID)).toBe(false);
  });

  it("rejects an overly long name", () => {
    expect(isValidPhotoName(`places/${PLACE_ID}/photos/${"a".repeat(2000)}`, PLACE_ID)).toBe(false);
  });
});

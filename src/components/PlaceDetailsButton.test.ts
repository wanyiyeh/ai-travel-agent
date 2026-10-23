import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlaceDetailsButton } from "./PlaceDetailsButton";

// Story: a saved trip has no photos (names aren't stored, ADR-0004), so each
// Google place in the list gets its own way into the details view (#258).
describe("PlaceDetailsButton", () => {
  it("shows for a Google place, kept in the read-only view and left off the PDF", () => {
    const html = renderToStaticMarkup(createElement(PlaceDetailsButton, { placeId: "ChIJ-sensoji" }));
    expect(html).toContain("照片與詳情");
    expect(html).toContain("data-readonly-keep");
    expect(html).toContain("data-print-hidden");
  });

  it("shows nothing for an item without a place ID (a train ride, a typed-in event)", () => {
    expect(renderToStaticMarkup(createElement(PlaceDetailsButton, { placeId: undefined }))).toBe("");
  });
});

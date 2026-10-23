import { existsSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GoogleMapsAttribution from "./GoogleMapsAttribution";

// Places API policies, "Attribution": the official logo, 16–19px tall,
// labelled "Google Maps" and never translated by the browser.
describe("GoogleMapsAttribution", () => {
  const html = renderToStaticMarkup(createElement(GoogleMapsAttribution));

  it("keeps the browser from translating it", () => {
    expect(html).toContain('translate="no"');
  });

  it("labels both logos Google Maps at a height within the allowed range", () => {
    const logos = html.match(/<img [^>]*>/g) ?? [];
    expect(logos).toHaveLength(2);
    for (const logo of logos) {
      expect(logo).toContain('alt="Google Maps"');
      expect(logo).toContain("h-[18px]");
    }
  });

  it("points at logo files that exist", () => {
    for (const [, src] of html.matchAll(/src="([^"]+)"/g)) {
      expect(existsSync(join(process.cwd(), "public", src))).toBe(true);
    }
  });
});

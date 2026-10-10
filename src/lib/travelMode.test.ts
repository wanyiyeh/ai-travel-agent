import { describe, expect, it } from "vitest";
import { modePickerFor } from "@/lib/travelMode";

describe("modePickerFor", () => {
  it.each([
    ["public transport", {}, 1.0, "walking"],
    ["public transport", {}, 3, "transit"],
    ["public transport, a day trip out of town", {}, 40, "transit"],
    ["public transport", {}, 80, "driving"],
    ["indoor first", { indoorFirst: true }, 0.8, "transit"],
    // 自駕: short hops on foot rather than re-parking, the rental car beyond.
    ["self-drive", { selfDrive: true }, 0.8, "walking"],
    ["self-drive", { selfDrive: true }, 1.5, "driving"],
    ["self-drive, indoor first", { selfDrive: true, indoorFirst: true }, 0.8, "driving"],
    // 長輩: no further on foot than indoor first.
    ["with older relatives", { seniors: true }, 0.8, "transit"],
    ["with older relatives", { seniors: true }, 0.4, "walking"],
  ] as const)("%s, %skm leg", (_who, prefs, km, mode) => {
    expect(modePickerFor(prefs)(km)).toBe(mode);
  });
});

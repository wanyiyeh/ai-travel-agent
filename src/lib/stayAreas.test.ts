import { describe, expect, it } from "vitest";
import { stayAreaFor } from "./stayAreas";

describe("stayAreaFor", () => {
  it("picks Tokyo's district by budget", () => {
    expect(stayAreaFor("東京", "budget")?.label).toBe("淺草／上野");
    expect(stayAreaFor("東京", "moderate")?.label).toBe("新宿");
    expect(stayAreaFor("東京", "luxury")?.label).toBe("銀座／丸之內");
    expect(stayAreaFor("東京", undefined)?.label).toBe("新宿");
  });

  it("has nothing for cities that one center serves", () => {
    expect(stayAreaFor("京都", "budget")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { cleanPlaceName } from "@/lib/fetchCityRestaurants";

describe("cleanPlaceName", () => {
  it("drops an advertisement in brackets", () => {
    expect(cleanPlaceName("花蓮將軍府1936(免預約入園，加LINE官方好友享優惠)")).toBe("花蓮將軍府1936");
    expect(cleanPlaceName("又一村文創-You-Yi-Tsun Cultural and Creative Park（各店家詳細營業時間請見粉專）")).toBe(
      "又一村文創-You-Yi-Tsun Cultural and Creative Park"
    );
  });

  it("keeps brackets that are part of the name", () => {
    expect(cleanPlaceName("須賀神社 (Suga Shrine)")).toBe("須賀神社 (Suga Shrine)");
    expect(cleanPlaceName("アパホテル〈浅草駅前〉")).toBe("アパホテル〈浅草駅前〉");
  });
});

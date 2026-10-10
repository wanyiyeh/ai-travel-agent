import { describe, expect, it } from "vitest";
import { cleanPlaceName } from "@/lib/fetchCityRestaurants";

describe("cleanPlaceName", () => {
  it("drops an advertisement in brackets", () => {
    expect(cleanPlaceName("花蓮將軍府1936(免預約入園，加LINE官方好友享優惠)")).toBe("花蓮將軍府1936");
    expect(cleanPlaceName("又一村文創-You-Yi-Tsun Cultural and Creative Park（各店家詳細營業時間請見粉專）")).toBe(
      "又一村文創-You-Yi-Tsun Cultural and Creative Park"
    );
  });

  it("drops a list of search keywords", () => {
    expect(cleanPlaceName("烏龜島咖啡甜點伴手禮|宜蘭名產|採現場後位最後出餐17:00")).toBe("烏龜島咖啡甜點伴手禮");
    expect(cleanPlaceName("鬥伙駅-大洲車站 《宜蘭縣三星鄉美食》寵物友善｜咖啡館｜知名人氣甜點｜早午餐景點")).toBe("鬥伙駅-大洲車站");
  });

  it("keeps a single bar, as in a branch name", () => {
    expect(cleanPlaceName("鼎泰豐 | 信義店")).toBe("鼎泰豐 | 信義店");
  });

  it("keeps brackets that are part of the name", () => {
    expect(cleanPlaceName("須賀神社 (Suga Shrine)")).toBe("須賀神社 (Suga Shrine)");
    expect(cleanPlaceName("アパホテル〈浅草駅前〉")).toBe("アパホテル〈浅草駅前〉");
  });
});

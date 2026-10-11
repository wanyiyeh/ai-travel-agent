import { describe, expect, it } from "vitest";
import { ISLAND_GROUPS, islandAt, islandGroupOf, islandNamed, onSearchIsland } from "@/lib/islandGroups";

const matsu = ISLAND_GROUPS["TW-MZU"];
const penghu = ISLAND_GROUPS["TW-PEH"];
const at = (name: string, lat: number, lng: number) => ({ name, lat, lng });

describe("islandNamed", () => {
  it("takes the group's name as its main island", () => {
    expect(islandNamed("馬祖")?.name).toBe("南竿");
    expect(islandNamed("北竿")?.name).toBe("北竿");
    expect(islandNamed("台南")).toBeUndefined();
    expect(islandGroupOf("七美")).toBe(penghu);
  });
});

describe("islandAt", () => {
  // Places from a 馬祖 trip, as Google placed them.
  it("tells 南竿's sights from 北竿's", () => {
    expect(islandAt(at("北海坑道", 26.1429, 119.9286), matsu).name).toBe("南竿");
    expect(islandAt(at("芹壁聚落", 26.2248, 119.9516), matsu).name).toBe("北竿");
    expect(islandAt(at("東引燈塔", 26.3724, 120.5075), matsu).name).toBe("東引");
  });

  it("keeps 白沙's 赤崁 and 西嶼 on 澎湖's main island, bridged to 馬公", () => {
    expect(islandAt(at("赤崁碼頭", 23.7064, 119.6031), penghu).name).toBe("澎湖");
    expect(islandAt(at("二崁聚落", 23.6267, 119.5221), penghu).name).toBe("澎湖");
    expect(islandAt(at("吉貝沙尾", 23.7339, 119.6181), penghu).name).toBe("吉貝");
    expect(islandAt(at("七美雙心石滬", 23.2134, 119.4269), penghu).name).toBe("七美");
  });
});

describe("onSearchIsland", () => {
  it("keeps a search on 南竿 to 南竿", () => {
    const found = [at("北海坑道", 26.1429, 119.9286), at("芹壁聚落", 26.2248, 119.9516), at("東引燈塔", 26.3724, 120.5075)];
    expect(onSearchIsland(matsu.main.center, found).map((p) => p.name)).toEqual(["北海坑道"]);
  });

  it("leaves a search anywhere else alone", () => {
    const found = [at("台北101", 25.0339, 121.5645)];
    expect(onSearchIsland({ lat: 25.04, lng: 121.56 }, found)).toEqual(found);
  });
});

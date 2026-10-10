import { describe, expect, it } from "vitest";
import { forSoloTraveler, isGroupDining, isSoloFriendly, nearStationFirst } from "@/lib/soloTravel";

// Types as cached for the first solo eval run's picks.
const ichiran = { name: "一蘭 新宿中央東口店", types: ["ramen_restaurant", "noodle_shop", "snack_bar"] };
const kura = { name: "藏壽司 西新宿店", types: ["family_restaurant", "sushi_restaurant", "japanese_restaurant"] };
const udonShin = { name: "Udon Shin", types: ["japanese_restaurant", "restaurant", "food"] };
const haidilao = { name: "海底撈火鍋 新宿店", types: ["hot_pot_restaurant", "japanese_izakaya_restaurant", "japanese_restaurant"] };
const gyuTongue = { name: "Gyu Tongue Lemon Shinjuku", types: ["yakiniku_restaurant", "japanese_restaurant", "restaurant"] };
const italian = { name: "Trattoria", types: ["italian_restaurant", "restaurant"] };

describe("isSoloFriendly", () => {
  it("counts any of a place's types, not just the first", () => {
    expect(isSoloFriendly(ichiran)).toBe(true);
    expect(isSoloFriendly(kura)).toBe(true);
  });

  it("knows an udon shop by its name when its types don't say", () => {
    expect(isSoloFriendly(udonShin)).toBe(true);
    expect(isSoloFriendly({ name: "麵散", types: ["japanese_restaurant"] })).toBe(true);
    expect(isSoloFriendly(italian)).toBe(false);
  });
});

describe("isGroupDining / forSoloTraveler", () => {
  it("calls hot pot and yakiniku places group dining", () => {
    expect(isGroupDining(haidilao)).toBe(true);
    expect(isGroupDining(gyuTongue)).toBe(true);
    expect(isGroupDining(ichiran)).toBe(false);
  });

  it("leaves shared pots and grills out, and puts places easy to eat at alone first", () => {
    expect(forSoloTraveler([italian, haidilao, kura, gyuTongue, udonShin]).map((p) => p.name)).toEqual([
      "藏壽司 西新宿店",
      "Udon Shin",
      "Trattoria",
    ]);
  });
});

describe("nearStationFirst", () => {
  it("puts lodging within 500m of a station first", () => {
    const station = { lat: 35.69, lng: 139.7 };
    const far = { name: "far", lat: 35.7, lng: 139.7 }; // ~1.1km
    const near = { name: "near", lat: 35.6935, lng: 139.7 }; // ~390m
    expect(nearStationFirst([far, near], [station]).map((p) => p.name)).toEqual(["near", "far"]);
    expect(nearStationFirst([far, near], []).map((p) => p.name)).toEqual(["far", "near"]);
  });
});

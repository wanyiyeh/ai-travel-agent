import { describe, expect, it } from "vitest";
import { notVisited, withoutSamePlace } from "@/lib/samePlace";

// As Google placed them on 南竿.
const tunnel = { name: "北海坑道", lat: 26.1425, lng: 119.929 };
const boats = { name: "北海坑道搖櫓", lat: 26.14286, lng: 119.9286 };

describe("withoutSamePlace", () => {
  it("counts one sight listed twice once, keeping the place itself", () => {
    expect(withoutSamePlace([boats, tunnel]).map((p) => p.name)).toEqual(["北海坑道"]);
  });

  it("keeps two places of one name far apart, and different names close by", () => {
    const otherTunnel = { name: "午沙坑道（北竿北海坑道）", lat: 26.2162, lng: 119.9787 }; // 北竿, 8km away
    const fort = { name: "鐵堡", lat: 26.1427, lng: 119.9291 };
    expect(withoutSamePlace([tunnel, otherTunnel, fort])).toHaveLength(3);
  });
});

describe("notVisited", () => {
  it("leaves out a place visited under another listing on an earlier day", () => {
    // Day 1 had 北海坑道; the return day picked 北海坑道搖櫓, another id.
    const fort = { name: "鐵堡", lat: 26.1427, lng: 119.9291 };
    expect(notVisited([boats, fort], [tunnel]).map((p) => p.name)).toEqual(["鐵堡"]);
  });
});


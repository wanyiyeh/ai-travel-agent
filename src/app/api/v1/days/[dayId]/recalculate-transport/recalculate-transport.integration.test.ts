import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, j } from "@/lib/db";
import { signInAs } from "@tests/setup/mockAuth";
import { POST } from "./route";

// Story: the traveler reorders a day and the app rewrites how each stop is
// reached. The first stop with no distance to go on reads 「從…出發」, naming
// where the day starts — the previous night's lodging. That text is stored
// with the stop, and a hotel's Google name may not be (ADR-0004), so it names
// the area instead.

const stamp = Date.now();
const owner = { id: `rt-owner-${stamp}`, email: `rt-owner-${stamp}@example.com` };
const itineraryId = `rt-trip-${stamp}`;
const dayId = `rt-day2-${stamp}`;
const transitDayId = `rt-day3-${stamp}`;

beforeAll(async () => {
  await prisma.user.create({ data: owner });
  await prisma.itinerary.create({
    data: {
      id: itineraryId,
      userId: owner.id,
      title: "東京",
      config: j({}),
      days: j([
        { id: `rt-day1-${stamp}`, day: 1, stops: [], accommodation: { name: "Hotel Gracery Shinjuku", area: "新宿" } },
        // No coordinates anywhere, so no distance lookup: the first stop gets the 「從…出發」 line.
        { id: dayId, day: 2, stops: [{ id: "s1", name: "明治神宮", description: "", duration_minutes: 60 }] },
        // A ride written before `kind` existed, recognised by its shape (ADR-0009).
        {
          id: transitDayId,
          day: 3,
          isTransitDay: true,
          transitTo: "京都",
          stops: [
            { id: "ride", name: "搭乘新幹線前往京都", description: "", duration_minutes: 140, time_of_day: "morning", transport_from_prev: "搭乘新幹線約 2 小時20分" },
            { id: "s2", name: "清水寺", description: "", duration_minutes: 90 },
            { id: "s3", name: "八坂神社", description: "", duration_minutes: 60 },
          ],
        },
      ]),
    },
  });
});

beforeEach(() => signInAs(owner)); // signed out after each test (tests/setup/mockAuth.ts)

describe("recalculate-transport", () => {
  it("names the area the day starts from, not the hotel", async () => {
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ itineraryId }) }), {
      params: Promise.resolve({ dayId }),
    });
    expect(res.status).toBe(200);

    const saved = await prisma.itinerary.findUniqueOrThrow({ where: { id: itineraryId } });
    const text = (saved.days as { stops: { transport_from_prev?: string }[] }[])[1].stops[0].transport_from_prev;
    expect(text).toBe("從新宿的住宿出發");
    expect(text).not.toContain("Gracery");
  });

  it("keeps a transit day's ride as written and starts the next stop from the arrival", async () => {
    const res = await POST(new Request("http://test", { method: "POST", body: JSON.stringify({ itineraryId }) }), {
      params: Promise.resolve({ dayId: transitDayId }),
    });
    expect(res.status).toBe(200);

    const saved = await prisma.itinerary.findUniqueOrThrow({ where: { id: itineraryId } });
    const stops = (saved.days as { stops: { transport_from_prev?: string; time_of_day?: string }[] }[])[2].stops;
    expect(stops[0]).toMatchObject({ transport_from_prev: "搭乘新幹線約 2 小時20分", time_of_day: "morning" });
    expect(stops[1].transport_from_prev).toBe("抵達京都後出發");
    // no coordinates between the two sights either: that one is still unknown
    expect(stops[2].transport_from_prev).toBe("交通方式未知（缺少座標）");
  });
});

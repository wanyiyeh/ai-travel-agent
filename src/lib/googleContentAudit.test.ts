import { describe, expect, it } from "vitest";
import { auditColumn, cleanColumn } from "@/lib/googleContentAudit";

const cutoff = Date.parse("2026-09-23T00:00:00.000Z");
const fresh = "2026-10-01T00:00:00.000Z";

const cleanStop = { id: "s1", placeId: "ChIJ-a", lat: 1, lng: 2, coordsFetchedAt: fresh, description: "寺廟。" };
const googleStop = { ...cleanStop, name: "淺草寺", address: "Asakusa", rating: 4.5 };

describe("auditColumn", () => {
  it("counts a row whose place item has fields the allowlist drops", () => {
    const days = [[{ day: 1, stops: [cleanStop] }], [{ day: 1, stops: [googleStop] }]];
    expect(auditColumn(days, "days", cutoff)).toEqual({ googleFields: 1, expiredCoords: 0 });
  });

  it("finds Google fields in meals, lodging and the days kept for undo", () => {
    const day = (extra: object) => ({ day: 1, stops: [cleanStop], ...extra });
    const rows = [
      [day({ meals: { lunch: { ...googleStop, id: "m" } } })],
      [day({ accommodation: { ...googleStop, id: "h" } })],
      [day({ _originalAfter: [{ stops: [googleStop] }] })],
    ];
    expect(auditColumn(rows, "days", cutoff).googleFields).toBe(3);
  });

  it("doesn't count the name of a place without a place ID: it's ours", () => {
    const ride = { id: "t", name: "搭乘新幹線", description: "約 2 小時" };
    expect(auditColumn([[{ day: 1, stops: [ride] }]], "days", cutoff).googleFields).toBe(0);
  });

  it("counts coordinates past the cutoff or without a fetch time", () => {
    const untimed = { ...cleanStop, coordsFetchedAt: undefined };
    expect(auditColumn([JSON.stringify(untimed)], "stop", cutoff)).toEqual({ googleFields: 0, expiredCoords: 1 });
  });

  it("reads candidate lists and JSON strings", () => {
    expect(auditColumn([JSON.stringify([cleanStop, googleStop])], "candidates", cutoff).googleFields).toBe(1);
  });
});

describe("cleanColumn", () => {
  it("strips the Google fields and keeps the place ID and our text", () => {
    const cleaned = JSON.parse(cleanColumn(JSON.stringify([{ day: 1, stops: [googleStop] }]), "days")!);
    expect(cleaned[0].stops[0]).toEqual(cleanStop);
  });

  it("leaves a clean column alone", () => {
    expect(cleanColumn([{ day: 1, stops: [cleanStop] }], "days")).toBeNull();
  });
});

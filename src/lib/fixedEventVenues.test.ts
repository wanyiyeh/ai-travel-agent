import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FixedEvent } from "@/lib/schemas";

const textMock = vi.fn();
vi.mock("@/lib/placesTextSearch", () => ({ getCityCenter: async () => ({ lat: 35.68, lng: 139.76 }) }));
vi.mock("@/lib/fetchCityRestaurants", () => ({ searchTextCandidates: (...args: unknown[]) => textMock(...args) }));

const { planDayEvents } = await import("./fixedEventVenues");

const dome = { placeId: "dome", name: "東京巨蛋", lat: 35.7056, lng: 139.7519, address: "Bunkyo" };

beforeEach(() => {
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "key");
  textMock.mockReset();
  textMock.mockResolvedValue([dome]);
});

describe("planDayEvents", () => {
  it("looks the venue up near the city and blocks the event's time", async () => {
    const concert: FixedEvent = { type: "concert", date: "2026-11-11", startTime: "18:00", venueName: "東京巨蛋" };

    const { fixed, meals } = await planDayEvents([concert], "東京", undefined);

    expect(textMock).toHaveBeenCalledWith("東京巨蛋", { lat: 35.68, lng: 139.76 }, "key", 50000);
    expect(fixed[0].block).toEqual({ startMinute: 18 * 60, endMinute: 21 * 60 });
    expect(fixed[0].stop).toMatchObject({ placeId: "dome", lat: 35.7056 });
    expect(meals).toEqual({});
  });

  it("keeps the typed name when the venue can't be found", async () => {
    textMock.mockResolvedValue([]);
    const show: FixedEvent = { type: "show", date: "2026-11-11", startTime: "19:00", venueName: "小劇場 X" };

    const { fixed } = await planDayEvents([show], "東京", undefined);

    expect(fixed[0].stop).toMatchObject({ name: "小劇場 X" });
    expect(fixed[0].stop).not.toHaveProperty("lat");
  });

  it("puts work with no place at the lodging, without a search", async () => {
    const work: FixedEvent = { type: "work", date: "2026-11-11", startTime: "14:00", endTime: "17:00" };

    const { fixed } = await planDayEvents([work], "東京", { lat: 35.69, lng: 139.7 });

    expect(textMock).not.toHaveBeenCalled();
    expect(fixed[0].stop).toMatchObject({ name: "在住宿工作", lat: 35.69 });
  });

  it("makes a reservation the meal it replaces, not a stop", async () => {
    const lunch: FixedEvent = { type: "reservation", date: "2026-11-11", startTime: "12:00", venueName: "東京巨蛋" };

    const { fixed, meals } = await planDayEvents([lunch], "東京", undefined);

    expect(fixed).toEqual([{ block: { startMinute: 12 * 60, endMinute: 13 * 60 + 30, meal: true } }]);
    expect(meals.lunch).toMatchObject({ name: "東京巨蛋", placeId: "dome", fixedEvent: { type: "reservation" } });
  });
});

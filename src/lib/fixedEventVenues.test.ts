import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FixedEvent } from "@/lib/schemas";

const textMock = vi.fn();
const nearbyMock = vi.fn();
vi.mock("@/lib/placesTextSearch", () => ({ getCityCenter: async () => ({ lat: 35.68, lng: 139.76 }) }));
vi.mock("@/lib/fetchCityRestaurants", () => ({
  searchTextCandidates: (...args: unknown[]) => textMock(...args),
  fetchNearbyPlaceCandidates: (...args: unknown[]) => nearbyMock(...args),
  getMealPlaceTypes: () => ["restaurant"],
}));

const { planDayEvents } = await import("./fixedEventVenues");

const dome = { placeId: "dome", name: "東京巨蛋", lat: 35.7056, lng: 139.7519, address: "Bunkyo" };

beforeEach(() => {
  vi.stubEnv("GOOGLE_PLACES_API_KEY", "key");
  textMock.mockReset();
  textMock.mockResolvedValue([dome]);
  nearbyMock.mockReset();
  nearbyMock.mockResolvedValue([]);
});

describe("planDayEvents", () => {
  it("looks the venue up near the city and blocks the event's time", async () => {
    const concert: FixedEvent = { type: "concert", date: "2026-11-11", startTime: "18:00", venueName: "東京巨蛋" };

    const { fixed, meals } = await planDayEvents([concert], "東京", undefined);

    expect(textMock).toHaveBeenCalledWith("東京巨蛋", { lat: 35.68, lng: 139.76 }, "key", 50000);
    // Arriving 2 hours early (the concert default) is part of the blocked time.
    expect(fixed[0].block).toEqual({ startMinute: 16 * 60, endMinute: 21 * 60 });
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

// 2d-3: an evening show brings dinner near the venue before it.
describe("planDayEvents — dinner before a show", () => {
  const concert: FixedEvent = { type: "concert", date: "2026-11-11", startTime: "18:00", venueName: "東京巨蛋" };
  const ramen = { placeId: "ramen", name: "Ramen Near Dome", lat: 35.706, lng: 139.752, address: "a", types: ["ramen_restaurant"] };

  it("makes dinner a restaurant near the venue", async () => {
    nearbyMock.mockResolvedValue([ramen]);

    const { meals } = await planDayEvents([concert], "東京", undefined, { currency: "JPY" });

    expect(nearbyMock.mock.calls[0][0]).toEqual({ lat: dome.lat, lng: dome.lng });
    expect(meals.dinner).toMatchObject({ name: "Ramen Near Dome", description: "開場前在東京巨蛋附近用餐", copyPending: true });
  });

  // Story: near 東京巨蛋 the top "restaurants" were hotels with a dining room
  // and a McDonald's; Hotel Kizankan became the pre-concert dinner.
  it("skips hotels and global chains for a place to eat", async () => {
    const hotel = { ...ramen, placeId: "kizankan", name: "Hotel Kizankan", types: ["japanese_izakaya_restaurant", "hotel"] };
    const mcd = { ...ramen, placeId: "mcd", name: "McDonald's 水道橋店", types: ["fast_food_restaurant"] };
    nearbyMock.mockResolvedValue([hotel, mcd, ramen]);

    const { meals } = await planDayEvents([concert], "東京", undefined);

    expect(meals.dinner).toMatchObject({ name: "Ramen Near Dome" });
  });

  it("keeps a dinner reservation the traveler made", async () => {
    nearbyMock.mockResolvedValue([ramen]);
    const booked: FixedEvent = { type: "reservation", date: "2026-11-11", startTime: "17:00", venueName: "東京巨蛋" };

    const { meals } = await planDayEvents([concert, booked], "東京", undefined);

    expect(meals.dinner).toMatchObject({ fixedEvent: { type: "reservation" } });
  });

  it("leaves dinner alone for an afternoon show", async () => {
    nearbyMock.mockResolvedValue([ramen]);

    const { meals } = await planDayEvents([{ ...concert, startTime: "13:00" }], "東京", undefined);

    expect(nearbyMock).not.toHaveBeenCalled();
    expect(meals).toEqual({});
  });

  it("notes a long way back when the venue is far from the lodging", async () => {
    const { fixed } = await planDayEvents([concert], "東京", { lat: 35.4437, lng: 139.638 }); // Yokohama

    expect(String(fixed[0].stop?.description)).toContain("散場回住宿較遠");
  });
});

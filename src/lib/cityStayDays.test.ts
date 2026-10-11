import { describe, expect, it, vi } from "vitest";
import { NEUTRAL_PREFERENCE_INTENT } from "@/lib/schemas";

// stayContextOf only builds the trip's shared state; nothing here calls out.
vi.mock("@/lib/openai", () => ({ openai: {} }));
vi.mock("@/lib/db", () => ({ prisma: {}, j: (v: unknown) => v }));

const { stayContextOf } = await import("@/lib/cityStayDays");
const { isInOtherCity } = await import("@/lib/suburbTrips");

describe("stayContextOf — Taiwan's other towns", () => {
  const ctx = stayContextOf({
    preferences: undefined,
    preferenceIntent: NEUTRAL_PREFERENCE_INTENT,
    mealPreferences: {},
    budget: undefined,
    currency: "TWD",
    model: "m",
    departureDate: "2026-11-10",
    returnDate: "2026-11-13",
    routeCityNames: ["台南"],
  });

  it("keeps 台南's outdoors day out away from 高雄, not on the route", () => {
    // Where 台南's half day went, 高雄 not being on the route.
    const pier16 = { lat: 22.6195, lng: 120.2817 };
    expect(isInOtherCity(pier16, ctx.townCentersBesides("台南"))).toBe(true);
  });

  it("doesn't count the city itself", () => {
    const anping = { lat: 23.0012, lng: 120.1604 }; // 安平, in 台南
    expect(isInOtherCity(anping, ctx.townCentersBesides("台南"))).toBe(false);
  });
});

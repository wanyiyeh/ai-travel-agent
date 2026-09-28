import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, j } from "@/lib/db";
import type { DayWithId } from "@/types/itinerary";

// enrich-all-stops -> translatePlaceNames -> openai.ts throws at import time
// without a key; translation is display-only, so stub it as identity.
vi.mock("@/lib/translatePlaceNames", () => ({
  translatePlaceNames: async (names: string[]) => new Map(names.map((n) => [n, n])),
}));

const { POST: enrichAllStops } = await import("./route");

// Story: an itinerary has a stop and a meal Google can't resolve. The page's
// auto-enrich runs on every open — the first run should pay for the lookup
// once and leave a marker; the second run must not call Google for them again.
describe("enrich-all-stops remembers failed lookups", () => {
  const dayId = "enrich-failure-day-1";
  const cityHint = "Enrich Failure Test City";
  let itineraryId: string;
  const textQueries: string[] = [];

  beforeAll(async () => {
    process.env.GOOGLE_PLACES_API_KEY ??= "test-key";
    const user = await prisma.user.create({
      data: { email: `enrich-failure-${Date.now()}@test.local` },
    });
    const itinerary = await prisma.itinerary.create({
      data: {
        userId: user.id,
        title: "Enrich Failure Test Trip",
        days: j([
          {
            id: dayId,
            day: 1,
            waypointCity: cityHint,
            stops: [{ id: "s1", name: "前往巴塞隆納", description: "", duration_minutes: 60 }],
            meals: { dinner: { name: "晚餐" } },
          },
        ]),
        config: j({}),
      },
    });
    itineraryId = itinerary.id;

    // Every Text Search comes back empty — nothing resolves.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        textQueries.push(JSON.parse(String(init?.body)).textQuery);
        return new Response(JSON.stringify({ places: [] }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    textQueries.length = 0;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await prisma.itinerary.delete({ where: { id: itineraryId } });
    await prisma.user.deleteMany({ where: { itineraries: { none: {} } } });
  });

  const run = () =>
    enrichAllStops(new Request("http://test/api", { method: "POST" }), {
      params: Promise.resolve({ id: itineraryId }),
    });

  it("first run queries Google and marks both items as not found", async () => {
    const res = await run();
    expect(res.status).toBe(200);
    expect(textQueries).toContain(`前往巴塞隆納 ${cityHint}`);
    expect(textQueries).toContain(`晚餐 ${cityHint}`);

    const saved = await prisma.itinerary.findUniqueOrThrow({ where: { id: itineraryId } });
    const day = (saved.days as DayWithId[])[0];
    expect(day.stops[0].enrichFailure).toMatchObject({ query: `前往巴塞隆納 ${cityHint}`, reason: "not_found" });
    expect(day.meals?.dinner?.enrichFailure).toMatchObject({ query: `晚餐 ${cityHint}`, reason: "not_found" });
  });

  it("second run skips them instead of re-billing Google", async () => {
    const res = await run();
    expect(res.status).toBe(200);
    expect(textQueries).not.toContain(`前往巴塞隆納 ${cityHint}`);
    expect(textQueries).not.toContain(`晚餐 ${cityHint}`);
  });

  it("a renamed item gets looked up again", async () => {
    const saved = await prisma.itinerary.findUniqueOrThrow({ where: { id: itineraryId } });
    const days = saved.days as DayWithId[];
    days[0].meals = { ...days[0].meals, dinner: { ...days[0].meals?.dinner, name: "Time Out Market" } };
    await prisma.itinerary.update({ where: { id: itineraryId }, data: { days: j(days) } });

    await run();
    expect(textQueries).toContain(`Time Out Market ${cityHint}`);
    expect(textQueries).not.toContain(`前往巴塞隆納 ${cityHint}`);
  });
});

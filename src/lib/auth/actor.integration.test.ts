import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { signInAs } from "@tests/setup/mockAuth";
import { getActor } from "@/lib/auth/actor";
import { mockGoogleResponse } from "@/lib/mockPlaces";

const { POST } = await import("@/app/api/v1/generate-stream/route");

// Story (#225): the developer signed in while the app ran on dev.db, then
// restarted on dev:mock's mock.db in the same browser. The session still
// carries a user id from dev.db that mock.db has never seen; saving a
// generated itinerary under it failed on the foreign key, and the page sat
// at "行程已生成，正在跳轉…" forever. Now the user is found by email, or
// created, in whichever database is running.

const stamp = Date.now();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a session whose user row isn't in this database", () => {
  it("is given the row for its email instead of the missing id", async () => {
    const email = `moved-${stamp}@example.com`;
    signInAs({ id: `from-another-db-${stamp}`, email });

    const actor = await getActor();

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row).not.toBeNull();
    expect(actor).toMatchObject({ kind: "user", userId: row!.id, email });
  });

  it("reuses the existing row for that email, so it keeps its itineraries", async () => {
    const email = `existing-${stamp}@example.com`;
    const existing = await prisma.user.create({ data: { email } });
    signInAs({ id: `from-another-db-2-${stamp}`, email });

    expect((await getActor())?.userId).toBe(existing.id);
  });

  it("leaves a session whose row exists exactly as it was", async () => {
    const user = await prisma.user.create({ data: { email: `here-${stamp}@example.com` } });
    signInAs({ id: user.id, email: user.email! });

    expect((await getActor())?.userId).toBe(user.id);
  });

  it("can generate and save an itinerary", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "integration-fake-key");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) =>
      new URL(url).hostname.endsWith("googleapis.com") ? mockGoogleResponse(url, init) : new Response("{}", { status: 404 }),
    ));
    signInAs({ id: `from-another-db-3-${stamp}`, email: `generates-${stamp}@example.com` });

    const res = await POST(new Request("http://test/api", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.140" },
      body: JSON.stringify({
        flightInfo: { departureCity: "TPE", arrivalCity: "NRT", returnDepartureCity: "NRT", departureDate: "2026-11-10", returnDate: "2026-11-12" },
      }),
    }));
    const complete = (await res.text())
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice(6)))
      .find((event) => event.type === "complete");

    expect(complete?.id).toBeTruthy();
    expect(await prisma.itinerary.findUnique({ where: { id: complete.id } })).not.toBeNull();
  });
});

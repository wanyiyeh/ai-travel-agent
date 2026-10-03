import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { upsertUserByEmail } from "./users";

// Signing in twice (or with different email casing) must land on the same
// User row, since that row's id is what owns the itineraries.
describe("upsertUserByEmail", () => {
  const email = `Signin-${Date.now()}@Example.com`;

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: email.toLowerCase() } });
  });

  it("creates once and returns the same id on later sign-ins", async () => {
    const first = await upsertUserByEmail(email, "Tester");
    const again = await upsertUserByEmail(email.toUpperCase(), null);
    expect(again.id).toBe(first.id);
    expect(first.email).toBe(email.toLowerCase());

    const row = await prisma.user.findUnique({ where: { id: first.id } });
    expect(row?.name).toBe("Tester"); // a missing name on re-sign-in doesn't wipe it
  });
});

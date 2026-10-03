/**
 * One-off: hands every itinerary owned by the old hardcoded demo user to the
 * first ADMIN_EMAILS account, so they stay visible once itineraries are
 * scoped to their owner (plan/access-control.md PR 1/2).
 *
 * Idempotent — re-running moves nothing once the demo user owns nothing.
 * Run once per database:
 *   npm run claim-demo-itineraries                                  # dev.db (DATABASE_URL in .env)
 *   DATABASE_URL="file:./mock.db" npm run claim-demo-itineraries    # mock.db
 * Makes no Google/OpenAI calls.
 */

import { PrismaClient } from "@prisma/client";
import { existsSync } from "fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  const adminEmail = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().replace(/^["']|["']$/g, "").toLowerCase())
    .find(Boolean);
  if (!adminEmail) throw new Error("ADMIN_EMAILS is empty — nothing to claim for");

  const prisma = new PrismaClient();
  try {
    // Same row Google sign-in will find (upsert by email), so signing in
    // later lands on these itineraries.
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      create: { email: adminEmail },
      update: {},
    });
    const { count } = await prisma.itinerary.updateMany({
      where: { userId: DEMO_USER_ID },
      data: { userId: admin.id },
    });
    console.log(`Moved ${count} itinerary(ies) from the demo user to ${adminEmail} (${process.env.DATABASE_URL}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

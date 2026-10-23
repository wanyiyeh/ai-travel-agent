/**
 * Removes Google content the terms don't let us keep from what was stored
 * before writes were stripped (ADR-0004, ADR-0006,
 * src/lib/googleContentAudit.ts): names, addresses, ratings and photos in
 * itineraries, the trash and candidate history, and coordinates past 30
 * days. Place IDs, our own text and fresh coordinates stay. Not reversible: back
 * the database up first.
 *
 * Without --yes it only prints what it would remove:
 *   npm run cleanup-google-content                                        # dry run, dev.db
 *   npm run cleanup-google-content -- --yes                               # dev.db
 *   DATABASE_URL="file:./mock.db" npm run cleanup-google-content -- --yes # mock.db
 * Safe to run again. Makes no Google/OpenAI calls.
 */

import { PrismaClient } from "@prisma/client";
import { existsSync } from "fs";
import { auditGoogleContent, cleanupGoogleContent } from "@/lib/googleContentAudit";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const prisma = new PrismaClient();
  try {
    const before = await auditGoogleContent(prisma);
    console.log(`Before (${process.env.DATABASE_URL}):`);
    console.log(JSON.stringify(before, null, 2));
    if (!process.argv.includes("--yes")) {
      console.log("Dry run: nothing changed. Re-run with -- --yes to remove the above.");
      return;
    }
    const result = await cleanupGoogleContent(prisma);
    console.log("Cleaned:", JSON.stringify(result));
    const after = await auditGoogleContent(prisma);
    console.log(after.total === 0 ? "Audit after cleanup: no violations." : `Audit after cleanup: ${after.total} left.`);
    if (after.total > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

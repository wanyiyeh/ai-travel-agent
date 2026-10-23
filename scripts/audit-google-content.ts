/**
 * Counts Google content the database still holds that the terms don't let
 * us keep (ADR-0004, ADR-0006, src/lib/googleContentAudit.ts). Exits with
 * status 1 when anything is found, so it can gate a deploy. Changes nothing.
 *
 *   npm run audit-google-content                                  # dev.db (DATABASE_URL in .env)
 *   DATABASE_URL="file:./mock.db" npm run audit-google-content    # mock.db
 * Makes no Google/OpenAI calls.
 */

import { PrismaClient } from "@prisma/client";
import { existsSync } from "fs";
import { auditGoogleContent } from "@/lib/googleContentAudit";

if (existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const prisma = new PrismaClient();
  try {
    const report = await auditGoogleContent(prisma);
    console.log(`Google content audit (${process.env.DATABASE_URL})`);
    console.log(JSON.stringify(report, null, 2));
    console.log(report.total === 0 ? "No violations." : `${report.total} violation(s): run npm run cleanup-google-content.`);
    if (report.total > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

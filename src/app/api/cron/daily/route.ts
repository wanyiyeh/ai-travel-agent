import { timingSafeEqual } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { runDailyHousekeeping } from "@/lib/housekeeping";

// Daily cleanup, called by Vercel Cron (vercel.json): expired guests and
// usage, stale rate-limit state, and Google coordinates past 30 days
// (src/lib/housekeeping.ts, #211). Vercel sends
// "Authorization: Bearer $CRON_SECRET"; anyone else gets a 401, and without
// a CRON_SECRET nothing can run it at all.

export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A plain client: the purge rewrites JSON columns as stored strings, and
  // the extended one in db.ts would parse and strip them again.
  const prisma = new PrismaClient();
  try {
    const result = await runDailyHousekeeping(prisma);
    console.info(`[cron/daily] ${JSON.stringify(result)}`);
    return Response.json(result);
  } finally {
    await prisma.$disconnect();
  }
}

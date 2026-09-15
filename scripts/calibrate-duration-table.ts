/**
 * Recalibrates assignTimeSlots.ts's DEFAULT_DURATION_BY_TYPE from real data,
 * per the finding in plan/hybrid-rule-engine-scheduling.md section 7: giving
 * the rule engine real Place `types` didn't shrink the duration-estimate gap
 * (63->67 min) because the table's numbers (museum:90, temple:45, ...) were
 * placeholder guesses, never checked against what the LLM actually assigns.
 *
 * For every stop across all seeded itineraries whose placeId resolves to a
 * category via mapPlaceTypeToCategory (using Place.types backfilled by
 * scripts/backfill-place-types.ts), buckets its real `duration_minutes` by
 * category and reports count/median/mean — a suggested replacement table.
 *
 * Read-only: no writes, no API calls (reuses the already-backfilled Place.types).
 * Run: npx tsx scripts/calibrate-duration-table.ts
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";
import { mapPlaceTypeToCategory } from "../src/lib/scheduler/mapPlaceTypeToCategory";
import type { DurationCategory } from "../src/lib/scheduler/assignTimeSlots";

try {
  const envContent = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {}

const prisma = new PrismaClient();

type LlmStop = { placeId?: string; duration_minutes: number };
type LlmDay = { isTransitDay?: boolean; stops?: LlmStop[] };

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const [itineraries, places] = await Promise.all([
    prisma.itinerary.findMany({ select: { days: true } }),
    prisma.place.findMany({ where: { types: { not: null } }, select: { id: true, types: true } }),
  ]);

  const categoryByPlaceId = new Map<string, DurationCategory>();
  for (const p of places) {
    const category = mapPlaceTypeToCategory(JSON.parse(p.types as string));
    if (category) categoryByPlaceId.set(p.id, category);
  }

  const durationsByCategory = new Map<DurationCategory, number[]>();
  for (const it of itineraries) {
    const days = JSON.parse(it.days as unknown as string) as LlmDay[];
    for (const day of days) {
      if (day.isTransitDay) continue;
      for (const s of day.stops ?? []) {
        if (!s.placeId) continue;
        const category = categoryByPlaceId.get(s.placeId);
        if (!category) continue;
        if (!durationsByCategory.has(category)) durationsByCategory.set(category, []);
        durationsByCategory.get(category)!.push(s.duration_minutes);
      }
    }
  }

  console.log("類別\t樣本數\t中位數\t平均值\t目前預設值");
  const CURRENT_DEFAULTS: Record<DurationCategory, number> = {
    museum: 90, viewpoint: 30, temple: 45, park: 60, shopping: 60, landmark: 45,
  };
  const MIN_SAMPLES_TO_TRUST = 5;

  for (const category of Object.keys(CURRENT_DEFAULTS) as DurationCategory[]) {
    const durations = durationsByCategory.get(category) ?? [];
    if (durations.length === 0) {
      console.log(`${category}\t0\t-\t-\t${CURRENT_DEFAULTS[category]}（無樣本，維持原值）`);
      continue;
    }
    const med = median(durations);
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    const note = durations.length < MIN_SAMPLES_TO_TRUST ? "（樣本數過少，僅供參考）" : "";
    console.log(`${category}\t${durations.length}\t${med.toFixed(0)}\t${mean.toFixed(0)}\t${CURRENT_DEFAULTS[category]}${note}`);
  }

  console.log(`\n未落在任何分類的樣本數: ${
    itineraries.reduce((sum, it) => {
      const days = JSON.parse(it.days as unknown as string) as LlmDay[];
      return sum + days.filter((d) => !d.isTransitDay).reduce((s, d) =>
        s + (d.stops ?? []).filter((st) => !st.placeId || !categoryByPlaceId.get(st.placeId)).length, 0);
    }, 0)
  }`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

/**
 * Phase 2 "shadow mode" of plan/hybrid-rule-engine-scheduling.md: for every
 * seeded itinerary day that already has a full LLM-generated stop order and
 * real coordinates, run the same stops through the rule engine
 * (buildDaySkeleton) and compare its output — stop order, time_of_day,
 * estimated duration — against what the LLM actually produced.
 *
 * This does NOT test candidate *selection* (the rule engine is given exactly
 * the stops the LLM already picked, not a larger pool) — only whether its
 * ordering/time-slotting logic lands somewhere reasonable relative to a real
 * generation. That's the comparison plan section 5 Phase 2 calls for before
 * wiring the rule engine into any real route.
 *
 * Read-only: no writes to the DB, no OpenAI/Places calls.
 * Run: npx tsx scripts/shadow-compare-scheduler.ts [pace] [--verbose]
 *   pace: relaxed | moderate | intensive (default: moderate)
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";
import { buildDaySkeleton, type SkeletonStop } from "../src/lib/scheduler/buildDaySkeleton";
import type { StopCandidate } from "../src/lib/scheduler/selectAndOrderStops";
import type { DurationCategory, Pace } from "../src/lib/scheduler/assignTimeSlots";
import { mapPlaceTypeToCategory } from "../src/lib/scheduler/mapPlaceTypeToCategory";

try {
  const envContent = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {}

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const paceArg = args.find((a): a is Pace =>
  a === "relaxed" || a === "moderate" || a === "intensive"
);
const pace: Pace = paceArg ?? "moderate";

type LlmStop = {
  id?: string;
  name: string;
  lat?: number;
  lng?: number;
  rating?: number | null;
  duration_minutes: number;
  time_of_day?: "morning" | "afternoon" | "evening";
  placeId?: string;
};

type LlmDay = {
  id?: string;
  day: number;
  isTransitDay?: boolean;
  stops?: LlmStop[];
  accommodation?: { lat?: number; lng?: number } | null;
};

type DayComparison = {
  itineraryTitle: string;
  dayNumber: number;
  stopCount: number;
  orderExactMatch: boolean;
  avgPositionDelta: number;
  timeOfDayAgreementPct: number | null; // null when LLM stored no time_of_day at all
  avgDurationDeltaMinutes: number;
  typedCandidateCount: number;
};

function compareDay(
  itineraryTitle: string,
  day: LlmDay,
  categoryByPlaceId: Map<string, DurationCategory>
): DayComparison | null {
  const stops = day.stops ?? [];
  if (day.isTransitDay || stops.length < 2) return null;
  if (!stops.every((s) => typeof s.lat === "number" && typeof s.lng === "number")) return null;

  // ids are synthesized here (not real stop ids), but only need to be unique
  // and stable within this one day so llmById/skeleton lookups line up.
  const idOf = (i: number) => `${day.id ?? day.day}-${i}`;
  const llmById = new Map(stops.map((s, i) => [idOf(i), s]));

  let typedCandidateCount = 0;
  const candidates: StopCandidate[] = stops.map((s, i) => {
    const type = s.placeId ? categoryByPlaceId.get(s.placeId) : undefined;
    if (type) typedCandidateCount++;
    return {
      id: idOf(i),
      lat: s.lat as number,
      lng: s.lng as number,
      rating: s.rating ?? null,
      type,
    };
  });

  const origin =
    typeof day.accommodation?.lat === "number" && typeof day.accommodation?.lng === "number"
      ? { lat: day.accommodation.lat, lng: day.accommodation.lng }
      : undefined;

  const skeleton: SkeletonStop[] = buildDaySkeleton(candidates, {
    count: candidates.length,
    pace,
    origin,
  });

  // Position comparison: where did each candidate land in the rule engine's
  // order vs. the LLM's original order?
  const llmIndexById = new Map(candidates.map((c, i) => [c.id, i]));
  const skeletonIndexById = new Map(skeleton.map((s, i) => [s.id, i]));

  let totalDelta = 0;
  for (const c of candidates) {
    totalDelta += Math.abs(llmIndexById.get(c.id)! - skeletonIndexById.get(c.id)!);
  }
  const avgPositionDelta = totalDelta / candidates.length;
  const orderExactMatch = avgPositionDelta === 0;

  // time_of_day agreement, only over stops where the LLM actually stored one
  // (older seeded data may not have it).
  const skeletonById = new Map(skeleton.map((s) => [s.id, s]));
  const withLlmTimeOfDay = [...llmById.entries()].filter(([, s]) => s.time_of_day);
  let timeOfDayAgreementPct: number | null = null;
  if (withLlmTimeOfDay.length > 0) {
    const agree = withLlmTimeOfDay.filter(
      ([id, s]) => skeletonById.get(id)?.time_of_day === s.time_of_day
    ).length;
    timeOfDayAgreementPct = (agree / withLlmTimeOfDay.length) * 100;
  }

  // Duration comparison — real Place-type-based lookup when the backfilled
  // Place.types resolved to one of assignTimeSlots' categories (see
  // mapPlaceTypeToCategory.ts and plan section 7), flat 60min fallback
  // otherwise. typedCandidateCount tracks how much of each day is real vs fallback.
  let totalDurationDelta = 0;
  for (const [id, s] of llmById) {
    const skeletonStop = skeletonById.get(id);
    if (skeletonStop) totalDurationDelta += Math.abs(skeletonStop.estimatedDurationMinutes - s.duration_minutes);
  }
  const avgDurationDeltaMinutes = totalDurationDelta / candidates.length;

  if (verbose) {
    const skeletonNames = skeleton.map((s) => llmById.get(s.id)?.name ?? s.id).join(" → ");
    console.log(`\n${itineraryTitle} 第 ${day.day} 天（${candidates.length} 站）`);
    console.log(`  LLM 順序:     ${stops.map((s) => s.name).join(" → ")}`);
    console.log(`  規則引擎順序: ${skeletonNames}`);
    console.log(`  平均位置差: ${avgPositionDelta.toFixed(2)}，時段一致率: ${timeOfDayAgreementPct?.toFixed(0) ?? "N/A"}%，平均時長差: ${avgDurationDeltaMinutes.toFixed(0)} 分鐘`);
  }

  return {
    itineraryTitle,
    dayNumber: day.day,
    stopCount: candidates.length,
    orderExactMatch,
    avgPositionDelta,
    timeOfDayAgreementPct,
    avgDurationDeltaMinutes,
    typedCandidateCount,
  };
}

async function main() {
  const itineraries = await prisma.itinerary.findMany({ select: { id: true, title: true, days: true } });

  // Backfilled by scripts/backfill-place-types.ts — only covers placeIds
  // already referenced by comparable days, not the full Place cache.
  const places = await prisma.place.findMany({ where: { types: { not: null } }, select: { id: true, types: true } });
  const categoryByPlaceId = new Map<string, DurationCategory>();
  for (const p of places) {
    const category = mapPlaceTypeToCategory(JSON.parse(p.types as string));
    if (category) categoryByPlaceId.set(p.id, category);
  }

  const results: DayComparison[] = [];
  let skippedTransit = 0;
  let skippedTooFewStops = 0;
  let skippedMissingCoords = 0;

  for (const it of itineraries) {
    const days = JSON.parse(it.days as unknown as string) as LlmDay[];
    for (const day of days) {
      const stops = day.stops ?? [];
      if (day.isTransitDay) { skippedTransit++; continue; }
      if (stops.length < 2) { skippedTooFewStops++; continue; }
      if (!stops.every((s) => typeof s.lat === "number" && typeof s.lng === "number")) {
        skippedMissingCoords++;
        continue;
      }
      const comparison = compareDay(it.title, day, categoryByPlaceId);
      if (comparison) results.push(comparison);
    }
  }

  console.log(`\n=== Phase 2 影子模式比較（pace=${pace}） ===`);
  console.log(`共 ${itineraries.length} 筆行程，可比較天數 ${results.length}`);
  console.log(
    `略過：${skippedTransit} 個 transit day、${skippedTooFewStops} 天站點數 < 2、` +
    `${skippedMissingCoords} 天缺少完整經緯度`
  );

  if (results.length === 0) {
    console.log("\n沒有可比較的天數（可能需要先跑 npm run enrich-all 補齊座標）。");
    return;
  }

  const exactMatchCount = results.filter((r) => r.orderExactMatch).length;
  const avgPositionDelta = results.reduce((sum, r) => sum + r.avgPositionDelta, 0) / results.length;
  const withTimeOfDay = results.filter((r) => r.timeOfDayAgreementPct != null);
  const avgTimeOfDayAgreement =
    withTimeOfDay.length > 0
      ? withTimeOfDay.reduce((sum, r) => sum + (r.timeOfDayAgreementPct ?? 0), 0) / withTimeOfDay.length
      : null;
  const avgDurationDelta = results.reduce((sum, r) => sum + r.avgDurationDeltaMinutes, 0) / results.length;
  const totalStops = results.reduce((sum, r) => sum + r.stopCount, 0);
  const totalTyped = results.reduce((sum, r) => sum + r.typedCandidateCount, 0);

  console.log(`\n順序完全相同的天數: ${exactMatchCount}/${results.length} (${((exactMatchCount / results.length) * 100).toFixed(0)}%)`);
  console.log(`平均每站位置差（0=完全一致）: ${avgPositionDelta.toFixed(2)}`);
  console.log(
    `time_of_day 一致率: ${avgTimeOfDayAgreement != null ? avgTimeOfDayAgreement.toFixed(0) + "%" : "N/A"}` +
    ` (${withTimeOfDay.length}/${results.length} 天有 LLM 原始 time_of_day 可比對)`
  );
  console.log(
    `平均時長估計差: ${avgDurationDelta.toFixed(0)} 分鐘 ` +
    `（${totalTyped}/${totalStops} 站有真實 Place type 對照，其餘落在 60 分鐘預設值）`
  );

  console.log(`\n用 --verbose 看逐天明細（LLM 順序 vs 規則引擎順序）。`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

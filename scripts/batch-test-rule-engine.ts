/**
 * Phase 6 scoping question from plan/hybrid-rule-engine-scheduling.md §0.9/§0.8:
 * before removing generate-stream's old full-LLM fallback, how often does the
 * rule-engine path (planTrip -> assembleItineraryDays) actually succeed across
 * a spread of real trip shapes? Manual browser testing so far is 2/2 (one
 * single-city, one multi-city+transit day) — not enough to make that call.
 *
 * Replicates the exact success/fallback decision generate-stream/route.ts
 * makes (assembleItineraryDays -> repairTransitDayDepartureCities/
 * repairMissingAccommodation -> validateItinerary + validateGeography), one
 * scenario at a time, against real OpenAI + Google Places APIs. Does NOT hit
 * the HTTP route or write to the DB — calls the same lib functions the route
 * calls, so no dev server needs to be running.
 *
 * Run: npx tsx scripts/batch-test-rule-engine.ts
 */

import { readFileSync } from "fs";
import { resolve } from "path";

try {
  const envContent = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z_][A-Z0-9_]*)="?([^"]*?)"?$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {}

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

type Scenario = {
  label: string;
  flightInfo: {
    departureCity: string;
    arrivalCity: string;
    returnDepartureCity: string;
    returnArrivalCity?: string;
    departureDate: string;
    returnDate: string;
    arrivalTime?: string;
    returnDepartureTime?: string;
  };
  prompt?: string;
  preferences?: {
    pace?: "relaxed" | "moderate" | "intensive";
    budget?: "budget" | "moderate" | "luxury";
    interests?: Array<"food" | "culture" | "nature" | "shopping" | "adventure">;
  };
};

// 8 scenarios spanning: short/long trips, single/multi-city, budget extremes,
// cold/uncommon cities, and a preference-heavy free-text case — the axes
// §0.9 flagged as never having been exercised through the real rule-engine
// path before.
const SCENARIOS: Scenario[] = [
  {
    label: "單城市・短程（3天）・台北→東京",
    flightInfo: { departureCity: "TPE", arrivalCity: "NRT", returnDepartureCity: "NRT", departureDate: "2026-12-05", returnDate: "2026-12-08" },
  },
  {
    label: "單城市・長程（10天）・台北→倫敦",
    flightInfo: { departureCity: "TPE", arrivalCity: "LHR", returnDepartureCity: "LHR", departureDate: "2027-01-10", returnDate: "2027-01-20" },
  },
  {
    label: "多城市・中程（9天）・台北→巴黎進／羅馬出",
    flightInfo: { departureCity: "TPE", arrivalCity: "CDG", returnDepartureCity: "FCO", departureDate: "2027-02-01", returnDate: "2027-02-10" },
  },
  {
    label: "極端 budget: luxury・台北→杜拜（5天）",
    flightInfo: { departureCity: "TPE", arrivalCity: "DXB", returnDepartureCity: "DXB", departureDate: "2027-01-15", returnDate: "2027-01-20" },
    preferences: { budget: "luxury" },
  },
  {
    label: "極端 budget: budget・台北→曼谷（4天）",
    flightInfo: { departureCity: "TPE", arrivalCity: "BKK", returnDepartureCity: "BKK", departureDate: "2026-12-10", returnDate: "2026-12-14" },
    preferences: { budget: "budget" },
  },
  {
    label: "冷門城市・台北→薩拉熱窩（5天）",
    flightInfo: { departureCity: "TPE", arrivalCity: "SJJ", returnDepartureCity: "SJJ", departureDate: "2027-03-01", returnDate: "2027-03-06" },
  },
  {
    label: "冷門城市・台北→盧布亞納（6天）",
    flightInfo: { departureCity: "TPE", arrivalCity: "LJU", returnDepartureCity: "LJU", departureDate: "2027-03-10", returnDate: "2027-03-16" },
  },
  {
    label: "極短程（2天週末）＋強偏好文字・台北→首爾",
    flightInfo: { departureCity: "TPE", arrivalCity: "ICN", returnDepartureCity: "ICN", departureDate: "2026-12-19", returnDate: "2026-12-21" },
    prompt: "不吃海鮮，行程排滿一點，早點出門，喜歡逛街購物",
    preferences: { pace: "intensive", interests: ["shopping"] },
  },
];

type ScenarioResult = {
  label: string;
  outcome: "success" | "plan_null" | "threw" | "validation_failed";
  errorSummary?: string;
  dayCount?: number;
  errorCodes?: string[];
  warningCodes?: string[];
  elapsedMs: number;
};

async function main() {
  // Dynamic imports: src/lib/openai.ts throws at import time if
  // OPENAI_API_KEY isn't set yet (see CLAUDE.local.md's "known sharp edges"),
  // so these must come after the .env load above.
  const { assembleItineraryDays } = await import("../src/lib/assembleItineraryDays");
  const { repairMissingAccommodation, repairTransitDayDepartureCities } = await import("../src/lib/itineraryGen");
  const { validateItinerary } = await import("../src/lib/validateItinerary");
  const { validateGeography } = await import("../src/lib/validateGeography");
  const { iataToCity } = await import("../src/lib/iataCity");

  console.log(`=== Phase 6 scoping: 規則引擎路徑批量真實測試（model=${MODEL}） ===`);
  console.log(`共 ${SCENARIOS.length} 組情境，會打真實 OpenAI + Google Places API，預期需要數分鐘。\n`);

  const results: ScenarioResult[] = [];

  for (const [i, scenario] of SCENARIOS.entries()) {
    const started = Date.now();
    console.log(`[${i + 1}/${SCENARIOS.length}] ${scenario.label} ...`);
    try {
      const isMultiCity =
        iataToCity(scenario.flightInfo.returnDepartureCity) !== iataToCity(scenario.flightInfo.arrivalCity);

      const assembled = await assembleItineraryDays(
        scenario.flightInfo as never,
        scenario.prompt,
        scenario.preferences as never,
        MODEL
      );

      if (!assembled) {
        results.push({ label: scenario.label, outcome: "plan_null", elapsedMs: Date.now() - started });
        console.log(`    -> planTrip() 回傳 null（會 fallback 回舊 LLM 流程）\n`);
        continue;
      }

      const cityRepairedDays = isMultiCity
        ? repairTransitDayDepartureCities(assembled.days as never)
        : assembled.days;
      const repairedDays = repairMissingAccommodation(cityRepairedDays as never);
      const finalItinerary = { ...assembled, days: repairedDays };

      const logicResult = validateItinerary(
        finalItinerary as never,
        scenario.flightInfo as never,
        iataToCity(scenario.flightInfo.arrivalCity),
        iataToCity(scenario.flightInfo.returnDepartureCity)
      );
      logicResult.issues.push(...validateGeography(finalItinerary as never));

      const errors = logicResult.issues.filter((i: { severity: string }) => i.severity === "error");
      const warnings = logicResult.issues.filter((i: { severity: string }) => i.severity === "warning");

      if (!logicResult.valid) {
        results.push({
          label: scenario.label,
          outcome: "validation_failed",
          errorCodes: errors.map((e: { code: string }) => e.code),
          dayCount: assembled.days.length,
          elapsedMs: Date.now() - started,
        });
        console.log(`    -> 驗證失敗（會 fallback）：${errors.map((e: { code: string }) => e.code).join(", ")}\n`);
        continue;
      }

      results.push({
        label: scenario.label,
        outcome: "success",
        dayCount: assembled.days.length,
        warningCodes: warnings.map((w: { code: string }) => w.code),
        elapsedMs: Date.now() - started,
      });
      console.log(
        `    -> 成功：${assembled.days.length} 天${warnings.length ? `，${warnings.length} 個警告（${warnings.map((w: { code: string }) => w.code).join(", ")}）` : "，無警告"}\n`
      );
    } catch (err) {
      results.push({
        label: scenario.label,
        outcome: "threw",
        errorSummary: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - started,
      });
      console.log(`    -> 拋出例外（會 fallback）：${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  const successCount = results.filter((r) => r.outcome === "success").length;
  console.log("=== 統計 ===");
  console.log(`成功（不觸發 fallback）：${successCount} / ${results.length}`);
  console.log(`會觸發 fallback 的情境：`);
  for (const r of results.filter((r) => r.outcome !== "success")) {
    console.log(`  - ${r.label}: ${r.outcome}${r.errorCodes ? ` (${r.errorCodes.join(", ")})` : ""}${r.errorSummary ? ` — ${r.errorSummary}` : ""}`);
  }
  console.log("\n詳細結果：");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

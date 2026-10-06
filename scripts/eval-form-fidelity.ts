/**
 * How much does each home-form choice actually change the itinerary?
 * plan/form-preference-wiring.md §4: after phase 1, measure with real APIs.
 *
 * Paired scenarios — same city and dates, one choice changed — run through
 * the same path generate-stream/route.ts takes (assembleItineraryDays ->
 * repairs -> validateItinerary + validateGeography), then measured with
 * src/lib/evalMetrics.ts and checked against what each choice should do.
 * Does not hit the HTTP route or save itineraries; candidate pools are cached
 * as usual. Each scenario logs its own "[usage] eval <id>" call counts.
 *
 * REAL OpenAI + Google calls — confirm before running (CLAUDE.local.md).
 *
 *   npm run eval-form-fidelity -- --dry-run            list scenarios, no API calls
 *   npm run eval-form-fidelity                         run everything
 *   npm run eval-form-fidelity -- --only=tokyo-baseline,tokyo-late
 *
 * Writes the full results to eval-results/form-fidelity-<timestamp>.json.
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

try {
  const envContent = readFileSync(resolve(process.cwd(), ".env"), "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z_][A-Z0-9_]*)="?([^"]*?)"?$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {}

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

type Preferences = {
  pace?: "relaxed" | "moderate" | "intensive";
  budget?: "budget" | "moderate" | "luxury";
  interests?: Array<"food" | "culture" | "nature" | "shopping" | "adventure">;
  startTime?: "early" | "normal" | "late";
  dietaryRestrictions?: Array<"vegetarian" | "vegan" | "no_seafood" | "no_beef" | "halal" | "no_spicy">;
};

type Scenario = {
  id: string;
  label: string;
  flightInfo: {
    departureCity: string;
    arrivalCity: string;
    returnDepartureCity: string;
    departureDate: string;
    returnDate: string;
  };
  prompt?: string;
  preferences?: Preferences;
};

// Tokyo, 4 days: 3 sightseeing days + the return day. Cities generated before,
// so most Places lookups hit the cache.
const TOKYO = {
  departureCity: "TPE",
  arrivalCity: "NRT",
  returnDepartureCity: "NRT",
  departureDate: "2026-11-10",
  returnDate: "2026-11-14",
};
const SAPPORO_WEEK = {
  departureCity: "TPE",
  arrivalCity: "CTS",
  returnDepartureCity: "CTS",
  departureDate: "2026-11-10",
  returnDate: "2026-11-17",
};

const SCENARIOS: Scenario[] = [
  { id: "tokyo-baseline", label: "東京 4 天・不選任何偏好（對照組）", flightInfo: TOKYO },
  { id: "tokyo-intensive", label: "東京・步調緊湊", flightInfo: TOKYO, preferences: { pace: "intensive" } },
  { id: "tokyo-relaxed", label: "東京・步調悠閒", flightInfo: TOKYO, preferences: { pace: "relaxed" } },
  { id: "tokyo-budget", label: "東京・經濟實惠", flightInfo: TOKYO, preferences: { budget: "budget" } },
  { id: "tokyo-luxury", label: "東京・高端奢華", flightInfo: TOKYO, preferences: { budget: "luxury" } },
  { id: "tokyo-culture", label: "東京・偏好文化歷史", flightInfo: TOKYO, preferences: { interests: ["culture"] } },
  { id: "tokyo-nature", label: "東京・偏好自然景觀", flightInfo: TOKYO, preferences: { interests: ["nature"] } },
  {
    id: "tokyo-vegetarian",
    label: "東京・素食",
    flightInfo: TOKYO,
    preferences: { dietaryRestrictions: ["vegetarian"] },
  },
  { id: "tokyo-late", label: "東京・晚起（11:00 出門）", flightInfo: TOKYO, preferences: { startTime: "late" } },
  { id: "sapporo-loop", label: "札幌 7 天・想去小樽（環狀多城市）", flightInfo: SAPPORO_WEEK, prompt: "想去小樽" },
];

type Metrics = import("../src/lib/evalMetrics").ItineraryMetrics;

type ScenarioResult = {
  id: string;
  label: string;
  outcome: "ok" | "validation_failed" | "plan_null" | "threw";
  errorCodes: string[];
  warningCodes: string[];
  error?: string;
  elapsedMs: number;
  currency?: string;
  metrics?: Metrics;
  days?: Array<Record<string, unknown>>;
};

type Check = { title: string; pass: (r: Map<string, Metrics>) => boolean | null; detail: (r: Map<string, Metrics>) => string };

const share = (m: Metrics | undefined, cats: string[]) =>
  m ? cats.reduce((sum, c) => sum + (m.categoryShare[c] ?? 0), 0) : NaN;
const pct = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "—" : `${Math.round(x * 100)}%`);
const fix1 = (x: number | undefined) => (x === undefined ? "—" : x.toFixed(1));
const both = (r: Map<string, Metrics>, ...ids: string[]) => ids.every((id) => r.has(id));

// What each form choice should do, judged from paired scenarios.
const CHECKS: Check[] = [
  {
    title: "步調：緊湊 > 對照 > 悠閒（每天景點數）",
    pass: (r) =>
      both(r, "tokyo-intensive", "tokyo-baseline", "tokyo-relaxed")
        ? r.get("tokyo-intensive")!.stopsPerDay > r.get("tokyo-baseline")!.stopsPerDay &&
          r.get("tokyo-baseline")!.stopsPerDay > r.get("tokyo-relaxed")!.stopsPerDay
        : null,
    detail: (r) =>
      ["tokyo-intensive", "tokyo-baseline", "tokyo-relaxed"]
        .map((id) => `${id} ${fix1(r.get(id)?.stopsPerDay)} 個／${Math.round(r.get(id)?.avgStayMinutes ?? 0)} 分`)
        .join("、"),
  },
  {
    title: "預算：經濟實惠的午晚餐 7 成以上在 NT$400 內，住宿是平價類型（青旅、民宿、平價旅館）",
    pass: (r) => {
      const m = r.get("tokyo-budget");
      return m ? (m.mainMealsWithinBudget ?? 0) >= 0.7 && m.lodging.some((l) => l.budgetTier) : null;
    },
    detail: (r) => {
      const m = r.get("tokyo-budget");
      return m ? `在預算內 ${pct(m.mainMealsWithinBudget)}、住宿 ${m.lodging.map((l) => l.name).join("／")}` : "—";
    },
  },
  {
    title: "預算：高端奢華的午晚餐 5 成以上在 NT$1,000～3,000，住宿是國際品牌",
    pass: (r) => {
      const m = r.get("tokyo-luxury");
      return m ? (m.mainMealsWithinBudget ?? 0) >= 0.5 && m.lodging.some((l) => l.luxury) : null;
    },
    detail: (r) => {
      const m = r.get("tokyo-luxury");
      return m ? `在預算內 ${pct(m.mainMealsWithinBudget)}、住宿 ${m.lodging.map((l) => l.name).join("／")}` : "—";
    },
  },
  {
    title: "偏好：文化歷史的博物館／寺廟／地標比例 > 自然景觀那組",
    pass: (r) =>
      both(r, "tokyo-culture", "tokyo-nature")
        ? share(r.get("tokyo-culture"), ["museum", "temple", "landmark"]) >
          share(r.get("tokyo-nature"), ["museum", "temple", "landmark"])
        : null,
    detail: (r) =>
      `文化組 ${pct(share(r.get("tokyo-culture"), ["museum", "temple", "landmark"]))}、自然組 ${pct(share(r.get("tokyo-nature"), ["museum", "temple", "landmark"]))}`,
  },
  {
    title: "偏好：自然景觀的公園／觀景台比例 > 文化歷史那組",
    pass: (r) =>
      both(r, "tokyo-culture", "tokyo-nature")
        ? share(r.get("tokyo-nature"), ["park", "viewpoint"]) > share(r.get("tokyo-culture"), ["park", "viewpoint"])
        : null,
    detail: (r) =>
      `自然組 ${pct(share(r.get("tokyo-nature"), ["park", "viewpoint"]))}、文化組 ${pct(share(r.get("tokyo-culture"), ["park", "viewpoint"]))}`,
  },
  {
    title: "飲食：素食組有素食餐廳、沒有牛排／海鮮／壽司",
    pass: (r) => {
      const m = r.get("tokyo-vegetarian");
      return m ? m.vegetarianShare > 0 && m.meatOrSeafoodMeals === 0 : null;
    },
    detail: (r) => {
      const m = r.get("tokyo-vegetarian");
      const base = r.get("tokyo-baseline");
      return m ? `素食餐廳 ${pct(m.vegetarianShare)}（對照組 ${pct(base?.vegetarianShare)}）、牛排／海鮮／壽司 ${m.meatOrSeafoodMeals} 餐` : "—";
    },
  },
  {
    title: "出門時間：晚起每天景點數 < 對照組",
    pass: (r) =>
      both(r, "tokyo-late", "tokyo-baseline") ? r.get("tokyo-late")!.stopsPerDay < r.get("tokyo-baseline")!.stopsPerDay : null,
    detail: (r) => `晚起 ${fix1(r.get("tokyo-late")?.stopsPerDay)} 個、對照 ${fix1(r.get("tokyo-baseline")?.stopsPerDay)} 個`,
  },
  {
    title: "環狀多城市：札幌出發，經過小樽，繞回札幌",
    pass: (r) => {
      const c = r.get("sapporo-loop")?.cities;
      return c ? c.length > 1 && c[0] === "札幌" && c[c.length - 1] === "札幌" && c.includes("小樽") : null;
    },
    detail: (r) => r.get("sapporo-loop")?.cities.join(" → ") ?? "—",
  },
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",");
  const scenarios = only ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;

  console.log(`=== 表單選項評分（model=${MODEL}）：${scenarios.length} 個情境 ===`);
  for (const s of scenarios) console.log(`  - ${s.id}: ${s.label}`);
  if (dryRun) {
    console.log("\n--dry-run：只列出情境，沒有呼叫任何 API。");
    return;
  }
  console.log("\n會呼叫真實的 OpenAI + Google Places API。\n");

  // Dynamic imports: src/lib/openai.ts throws at import time without
  // OPENAI_API_KEY, so these must come after the .env load above.
  const { assembleItineraryDays } = await import("../src/lib/assembleItineraryDays");
  const { repairMissingAccommodation, repairTransitDayDepartureCities } = await import("../src/lib/itineraryGen");
  const { validateItinerary } = await import("../src/lib/validateItinerary");
  const { validateGeography } = await import("../src/lib/validateGeography");
  const { iataToCity } = await import("../src/lib/iataCity");
  const { runMetered } = await import("../src/lib/usageMeter");
  const { measureItinerary } = await import("../src/lib/evalMetrics");
  const { getTwdRates } = await import("../src/lib/exchangeRate");
  const { prisma } = await import("../src/lib/db");

  const results: ScenarioResult[] = [];
  for (const [i, s] of scenarios.entries()) {
    console.log(`[${i + 1}/${scenarios.length}] ${s.label} ...`);
    const started = Date.now();
    const result: ScenarioResult = { id: s.id, label: s.label, outcome: "ok", errorCodes: [], warningCodes: [], elapsedMs: 0 };
    try {
      await runMetered(`eval ${s.id}`, async () => {
        const assembled = await assembleItineraryDays(s.flightInfo as never, s.prompt, s.preferences as never, MODEL);
        if (!assembled) {
          result.outcome = "plan_null";
          return;
        }
        // Same repairs as generate-stream/route.ts.
        const isMultiCity = iataToCity(s.flightInfo.returnDepartureCity) !== iataToCity(s.flightInfo.arrivalCity);
        const hasTransitDays = assembled.days.some((d) => d.isTransitDay === true);
        const cityRepaired =
          isMultiCity || hasTransitDays ? repairTransitDayDepartureCities(assembled.days as never) : assembled.days;
        const days = repairMissingAccommodation(cityRepaired as never) as unknown as Array<Record<string, unknown>>;
        const itinerary = { ...assembled, days };

        const validation = validateItinerary(
          itinerary as never,
          s.flightInfo as never,
          iataToCity(s.flightInfo.arrivalCity),
          iataToCity(s.flightInfo.returnDepartureCity)
        );
        validation.issues.push(...validateGeography(itinerary as never));
        result.errorCodes = validation.issues.filter((x) => x.severity === "error").map((x) => x.code);
        result.warningCodes = validation.issues.filter((x) => x.severity === "warning").map((x) => x.code);
        if (!validation.valid) result.outcome = "validation_failed";
        result.days = days;
        result.currency = assembled.currency;
      });
    } catch (err) {
      result.outcome = "threw";
      result.error = err instanceof Error ? err.message : String(err);
    }
    result.elapsedMs = Date.now() - started;
    console.log(`    -> ${result.outcome}${result.errorCodes.length ? ` (${result.errorCodes.join(", ")})` : ""}, ${Math.round(result.elapsedMs / 1000)}s\n`);
    results.push(result);
  }

  // Google types for every cached candidate, to classify stops and meals.
  const placeTypes = new Map<string, string[]>();
  for (const row of await prisma.nearbyPlaceCandidatesCache.findMany({ select: { candidates: true } })) {
    for (const c of JSON.parse(row.candidates) as Array<{ placeId?: string; types?: string[] }>) {
      if (c.placeId && c.types) placeTypes.set(c.placeId, c.types);
    }
  }
  const twdPerUnit = await getTwdRates();

  const metricsById = new Map<string, Metrics>();
  for (const r of results) {
    if (!r.days) continue;
    const scenario = scenarios.find((s) => s.id === r.id)!;
    const currency = r.currency ?? "JPY";
    r.metrics = measureItinerary(r.days, { placeTypes, twdPerUnit, currency, budget: scenario.preferences?.budget });
    metricsById.set(r.id, r.metrics);
  }

  console.log("=== 每個情境 ===");
  for (const r of results) {
    const m = r.metrics;
    if (!m) {
      console.log(`${r.id}: ${r.outcome}${r.error ? ` — ${r.error}` : ""}`);
      continue;
    }
    console.log(
      `${r.id}: ${r.outcome}｜景點 ${fix1(m.stopsPerDay)} 個/天、停留 ${Math.round(m.avgStayMinutes)} 分、空白觀光日 ${m.emptySightseeingDays}` +
        `｜午晚餐 NT$${m.avgMainMealTwd === null ? "—" : Math.round(m.avgMainMealTwd)}、在預算內 ${pct(m.mainMealsWithinBudget)}` +
        `｜重複 ${pct(m.mealRepeatRate)}、相鄰重複 ${m.adjacentRepeats}、AI 自編 ${m.inventedMeals}、缺餐 ${m.daysMissingMeals} 天` +
        `｜${m.cities.join("→")}`
    );
  }

  console.log("\n=== 各選項的效果 ===");
  const checkResults = CHECKS.map((c) => {
    const pass = c.pass(metricsById);
    const detail = c.detail(metricsById);
    console.log(`${pass === null ? "⏭" : pass ? "✅" : "❌"} ${c.title}\n     ${detail}`);
    return { title: c.title, pass, detail };
  });

  const outDir = resolve(process.cwd(), "eval-results");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `form-fidelity-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outFile, JSON.stringify({ model: MODEL, results, checks: checkResults }, null, 2));
  console.log(`\n完整結果：${outFile}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

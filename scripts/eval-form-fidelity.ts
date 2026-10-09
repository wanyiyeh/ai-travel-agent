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
// No import-time side effects (unlike openai.ts), so safe before the .env load.
import { NIGHTCAP_TYPES } from "../src/lib/drinkPlaces";
import { haversineKm } from "../src/lib/geo";

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
  interests?: Array<"food" | "culture" | "nature" | "shopping" | "water" | "land" | "adventure">;
  startTime?: "early" | "normal" | "late";
  indoorFirst?: boolean;
  fixedEvents?: Array<{
    type: "concert" | "sports" | "show" | "reservation" | "work" | "other";
    date: string;
    startTime: string;
    endTime?: string;
    venueName?: string;
    city?: string;
  }>;
  transport?: "transit" | "drive";
  dietaryRestrictions?: Array<"vegetarian" | "vegan" | "no_seafood" | "no_beef" | "halal" | "no_spicy">;
  drinks?: Array<"coffee" | "tea" | "alcohol">;
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
// In at Tokyo, out from Osaka, 6 days (5 to allocate + the return day), so
// a day-4 stop in 名古屋 still leaves day 5 for 大阪. With 11-15 (5 days) the
// concert fell on the last day to allocate and no route could fit it.
const TOKYO_TO_OSAKA = {
  departureCity: "TPE",
  arrivalCity: "NRT",
  returnDepartureCity: "KIX",
  departureDate: "2026-11-10",
  returnDate: "2026-11-16",
};
// Tokyo, 5 days: long enough that the trip should spend a night out of town.
const TOKYO_5_DAYS = { ...TOKYO, returnDate: "2026-11-15" };
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
    id: "tokyo-culture-nature",
    label: "東京・文化歷史＋自然景觀（主題輪流）",
    flightInfo: TOKYO,
    preferences: { interests: ["culture", "nature"] },
  },
  {
    id: "tokyo-vegetarian",
    label: "東京・素食",
    flightInfo: TOKYO,
    preferences: { dietaryRestrictions: ["vegetarian"] },
  },
  { id: "tokyo-late", label: "東京・晚起（11:00 出門）", flightInfo: TOKYO, preferences: { startTime: "late" } },
  { id: "tokyo-coffee", label: "東京・飲品選咖啡", flightInfo: TOKYO, preferences: { drinks: ["coffee"] } },
  { id: "tokyo-coffee-tea", label: "東京・飲品選咖啡＋抹茶（輪流）", flightInfo: TOKYO, preferences: { drinks: ["coffee", "tea"] } },
  { id: "tokyo-alcohol", label: "東京・飲品選酒（小酌）", flightInfo: TOKYO, preferences: { drinks: ["alcohol"] } },
  { id: "tokyo-indoor", label: "東京・室內行程為主", flightInfo: TOKYO, preferences: { indoorFirst: true } },
  {
    id: "tokyo-fixed",
    label: "東京・固定行程（第 2 天東京巨蛋演唱會 18:00、第 3 天午餐訂位）",
    flightInfo: TOKYO,
    preferences: {
      fixedEvents: [
        { type: "concert", date: "2026-11-11", startTime: "18:00", venueName: "東京巨蛋" },
        { type: "reservation", date: "2026-11-12", startTime: "12:00", venueName: "叙々苑 新宿" },
      ],
    },
  },
  { id: "tokyo-5-days", label: "東京 5 天・不選任何偏好（兩天一夜）", flightInfo: TOKYO_5_DAYS },
  { id: "sapporo-loop", label: "札幌 7 天・想去小樽（環狀多城市）", flightInfo: SAPPORO_WEEK, prompt: "想去小樽" },
  {
    id: "sapporo-drive",
    label: "札幌 7 天・自駕（機場取車、還車）",
    flightInfo: SAPPORO_WEEK,
    prompt: "想去小樽",
    preferences: { transport: "drive" },
  },
  {
    id: "multi-city-fixed",
    label: "東京進大阪出・第 4 天名古屋演唱會（固定行程的城市）",
    flightInfo: TOKYO_TO_OSAKA,
    preferences: {
      fixedEvents: [{ type: "concert", date: "2026-11-13", startTime: "18:00", venueName: "バンテリンドーム ナゴヤ", city: "名古屋" }],
    },
  },
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

// Tokyo Station — the city center 東京 trips search from (placesTextSearch.ts).
const TOKYO_CENTER = { lat: 35.6812, lng: 139.7671 };
// 小樽 Station — the sapporo-loop route stays there, so a Sapporo day trip shouldn't.
const OTARU_CENTER = { lat: 43.1978, lng: 140.9939 };
const tripKm = (trip: Metrics["suburbDays"][number] | undefined) => {
  const first = trip?.first;
  if (first?.lat === undefined || first.lng === undefined) return undefined;
  return haversineKm(TOKYO_CENTER.lat, TOKYO_CENTER.lng, first.lat, first.lng);
};

const COFFEE_TYPES = new Set(["coffee_shop", "coffee_roastery", "coffee_stand", "cafe"]);
const TEA_TYPES = new Set(["tea_house", "dessert_shop", "dessert_restaurant", "confectionery"]);
// A matcha place's primary type is often just "cafe", so for that the name decides.
const drinkKind = (s: { name: string; primaryType?: string }) =>
  TEA_TYPES.has(s.primaryType ?? "") || (s.primaryType === "cafe" && /抹茶|matcha|茶/i.test(s.name))
    ? "tea"
    : COFFEE_TYPES.has(s.primaryType ?? "")
      ? "coffee"
      : "other";

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
    title: "主題日：只選文化歷史，每個觀光日都是「文化巡禮」",
    pass: (r) => {
      const t = r.get("tokyo-culture")?.dayTitles;
      return t ? t.length > 0 && t.every((title) => title.endsWith("文化巡禮")) : null;
    },
    detail: (r) => r.get("tokyo-culture")?.dayTitles.join("、") ?? "—",
  },
  {
    title: "主題日：選文化＋自然，兩個主題輪流（不連續兩天同主題）",
    pass: (r) => {
      const t = r.get("tokyo-culture-nature")?.dayTitles;
      if (!t) return null;
      const hasBoth = t.some((x) => x.endsWith("文化巡禮")) && t.some((x) => x.endsWith("自然漫遊"));
      return hasBoth && t.every((x, i) => i === 0 || x !== t[i - 1]);
    },
    detail: (r) => r.get("tokyo-culture-nature")?.dayTitles.join("、") ?? "—",
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
    title: "飲品：選咖啡，7 成以上的點心是咖啡店，沒有星巴克等國際連鎖",
    pass: (r) => {
      const s = r.get("tokyo-coffee")?.snacks;
      if (!s || s.length === 0) return null;
      const coffee = s.filter((x) => COFFEE_TYPES.has(x.primaryType ?? "")).length / s.length;
      return coffee >= 0.7 && !s.some((x) => /starbucks|星巴克|スターバックス/i.test(x.name));
    },
    detail: (r) => r.get("tokyo-coffee")?.snacks.map((x) => `${x.name}（${x.primaryType ?? "?"}）`).join("、") ?? "—",
  },
  {
    title: "飲品：選咖啡＋抹茶，點心每天輪流",
    pass: (r) => {
      const s = r.get("tokyo-coffee-tea")?.snacks;
      if (!s || s.length < 2) return null;
      const kinds = s.map(drinkKind);
      return kinds.includes("coffee") && kinds.includes("tea") && kinds.every((k, i) => i === 0 || k !== kinds[i - 1]);
    },
    detail: (r) => r.get("tokyo-coffee-tea")?.snacks.map((x) => `${x.name}（${x.primaryType ?? "?"}）`).join("、") ?? "—",
  },
  {
    title: "飲品：選酒，回程日以外每晚都有小酌，而且是酒吧或居酒屋",
    pass: (r) => {
      const n = r.get("tokyo-alcohol")?.nightcaps;
      if (!n || n.length === 0) return null;
      return n.every((x) => x !== null && NIGHTCAP_TYPES.includes(x.primaryType ?? ""));
    },
    detail: (r) =>
      r.get("tokyo-alcohol")?.nightcaps.map((x) => (x ? `${x.name}（${x.primaryType ?? "?"}）` : "（沒有）")).join("、") ?? "—",
  },
  {
    title: "室內行程：戶外景點比例低於對照組，每天仍有 2 個以上景點",
    pass: (r) => {
      const indoor = r.get("tokyo-indoor");
      const base = r.get("tokyo-baseline");
      return indoor && base ? indoor.outdoorShare < base.outdoorShare && indoor.stopsPerDay >= 2 : null;
    },
    detail: (r) =>
      `室內組戶外 ${pct(r.get("tokyo-indoor")?.outdoorShare)}／每天 ${fix1(r.get("tokyo-indoor")?.stopsPerDay)} 個、對照組戶外 ${pct(r.get("tokyo-baseline")?.outdoorShare)}`,
  },
  {
    title: "交通：東京的景點之間沒有「搭計程車」（日本查不到大眾運輸，改用估計）",
    pass: (r) => {
      const m = r.get("tokyo-baseline");
      return m ? m.taxiLegs === 0 : null;
    },
    detail: (r) => `對照組 ${r.get("tokyo-baseline")?.taxiLegs ?? "—"} 段計程車`,
  },
  {
    title: "固定行程：第 2 天演唱會排在當天最後、晚餐在場館 1 km 內，第 3 天午餐換成訂位的店",
    pass: (r) => {
      const f = r.get("tokyo-fixed")?.fixedEvents;
      if (!f) return null;
      const concert = f.find((e) => e.as === "stop" && e.day === 2);
      const lunch = f.find((e) => e.as === "lunch" && e.day === 3);
      return Boolean(concert?.lastStop && (concert.dinnerKm ?? Infinity) <= 1 && lunch);
    },
    detail: (r) =>
      r.get("tokyo-fixed")?.fixedEvents
        .map((e) => `第 ${e.day} 天 ${e.name}（${e.as === "stop" ? `${e.lastStop ? "最後一站" : "景點"}，晚餐距離 ${e.dinnerKm ?? "?"} km` : e.as}）`)
        .join("、") ?? "—",
  },
  {
    title: "固定行程的城市：第 4 天在名古屋，演唱會排在那天",
    pass: (r) => {
      const m = r.get("multi-city-fixed");
      if (!m) return null;
      const concert = m.fixedEvents.find((e) => e.as === "stop");
      return concert?.day === 4 && concert.city === "名古屋";
    },
    detail: (r) => {
      const m = r.get("multi-city-fixed");
      const concert = m?.fixedEvents.find((e) => e.as === "stop");
      return m ? `路線 ${m.cities.join(" → ")}；演唱會在第 ${concert?.day ?? "?"} 天（${concert?.city ?? "?"}）` : "—";
    },
  },
  {
    title: "交通方式：自駕第 1 天先取車、最後一天還車，景點之間開車或走路，不搭大眾運輸",
    pass: (r) => {
      const m = r.get("sapporo-drive");
      if (!m) return null;
      return Boolean(
        m.tripEnds.first?.startsWith("機場取車") &&
          m.tripEnds.last?.startsWith("機場還車") &&
          m.legModes.drive > 0 &&
          m.legModes.transit === 0
      );
    },
    detail: (r) => {
      const m = r.get("sapporo-drive");
      return m
        ? `第一站 ${m.tripEnds.first ?? "?"}、最後一站 ${m.tripEnds.last ?? "?"}；開車 ${m.legModes.drive}、步行 ${m.legModes.walk}、大眾運輸 ${m.legModes.transit} 段`
        : "—";
    },
  },
  {
    title: "郊區：東京 4 天的對照組有一天一日遊，地點離東京車站 15～50 km",
    pass: (r) => {
      const trip = r.get("tokyo-baseline")?.suburbDays.find((d) => d.title.includes("一日遊"));
      if (!r.get("tokyo-baseline")) return null;
      const km = tripKm(trip);
      return km !== undefined && km >= 15 && km <= 50;
    },
    detail: (r) => {
      const trip = r.get("tokyo-baseline")?.suburbDays[0];
      return trip ? `第 ${trip.day} 天「${trip.title}」，離東京車站 ${tripKm(trip)?.toFixed(0) ?? "?"} km` : "沒有郊區行程";
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
  {
    // Only names to go on: the suburb stop doesn't carry Google's types.
    title: "季節：11 月的札幌，郊區行程不是滑雪場、海灘或碼頭，也不在路線上的小樽",
    pass: (r) => {
      const trips = r.get("sapporo-loop")?.suburbDays;
      if (!trips) return null;
      return trips.every((t) => {
        if (/滑雪|スキー|ski|海灘|海水浴|beach|marina|碼頭|マリーナ/i.test(t.title)) return false;
        const first = t.first;
        return first?.lat === undefined || first.lng === undefined || haversineKm(OTARU_CENTER.lat, OTARU_CENTER.lng, first.lat, first.lng) > 15;
      });
    },
    detail: (r) => r.get("sapporo-loop")?.suburbDays.map((t) => `第 ${t.day} 天「${t.title}」`).join("、") || "沒有郊區行程",
  },
  {
    title: "兩天一夜：東京 5 天，只到一個東京以外的城鎮過夜，再回東京",
    pass: (r) => {
      const stays = r.get("tokyo-5-days")?.nightStays;
      if (!stays) return null;
      const towns = stays.filter((s) => s.city !== "東京");
      return stays[0]?.city === "東京" && stays.at(-1)?.city === "東京" && towns.length === 1;
    },
    detail: (r) => r.get("tokyo-5-days")?.nightStays.map((s) => `${s.city} ${s.nights} 晚`).join(" → ") ?? "—",
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

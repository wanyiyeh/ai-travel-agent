import { z } from "zod";
import { openai } from "@/lib/openai";
import type { FlightInfo, TripPreferences } from "@/lib/schemas";
import { iataToCity } from "@/lib/iataCity";
import { calcDays, buildFlightTimePrompt, buildPreferencePrompt } from "@/lib/itineraryGen";
import { UNTRUSTED_INPUT_RULE, wrapUntrusted } from "@/lib/untrustedInput";
import { getIataCoords } from "@/lib/airports";
import { getCityCenter } from "@/lib/placesTextSearch";
import { haversineKm } from "@/lib/geo";
import { FIXED_EVENT_TYPES, tripDayOfDate } from "@/lib/fixedEvents";

// A round-trip flight (same airport in and out) used to be forced to one
// city, which kept a 7-day Hokkaido trip within 10km of Sapporo. With enough
// days it now loops out to a nearby town for a night and comes back (札幌 →
// 富良野 → 札幌, a 兩天一夜), unless the traveler asked to stay put: at
// least this many days to allocate (a 5-day trip)...
const LOOP_MIN_DAYS = 4;
// ...and every stop on the loop within ~3h by ground of the arrival city.
// Straight-line, so a bit generous: Sapporo–Hakodate is ~250km / 3.5h by train.
const MAX_LOOP_KM = 250;

// plan/hybrid-rule-engine-scheduling.md Phase 5(a): generate-stream currently
// has no structured city list at all — how many cities and how many days
// each get is decided implicitly, inside the single mega-completion that
// also writes every stop/meal/accommodation. This is the first step of
// pulling that decision out into its own small call, the same way
// parsePreferenceIntent() (preferenceIntent.ts) already separated out
// free-text preference parsing.
export const TripPlanSchema = z.object({
  title: z.string().min(1),
  // ISO 4217 code for the destination's local currency — itineraryCityGen.ts's
  // generation functions all assume the caller already knows this (the old
  // mega-prompt decides it itself as just one more output field), and
  // planTrip is already reasoning about the destination cities, so it's the
  // natural place to decide it too rather than adding a whole new call.
  currency: z.string().min(1),
  cities: z
    .array(
      z.object({
        name: z.string().min(1),
        // Mirrors restructure's CitySchema.targetDays semantics: the first
        // city's days exclude a leading transit day (the flight arrival IS
        // day 1), every later city's days include the transit day into it.
        days: z.number().int().min(1),
      })
    )
    .min(1),
});
export type TripPlan = z.infer<typeof TripPlanSchema>;

/**
 * A fixed event's city couldn't be fitted into the route after every
 * attempt. Not a reason to fall back to the old flow — that would quietly
 * drop the requirement — so generation stops and the traveler is told what
 * to change (plan/form-preference-wiring.md 2d-2).
 */
export class FixedEventCityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixedEventCityError";
  }
}

/** A 固定行程 the route must be in the right city for. */
export type CityRequirement = { dayNumber: number; date: string; city: string; label: string };

/** Fixed events that name a city, with the trip day they fall on. */
export function cityRequirements(flightInfo: FlightInfo, preferences: TripPreferences | undefined): CityRequirement[] {
  return (preferences?.fixedEvents ?? []).flatMap((event) => {
    const city = event.city?.trim();
    if (!city) return [];
    const dayNumber = tripDayOfDate(event.date, flightInfo.departureDate, flightInfo.returnDate);
    return dayNumber ? [{ dayNumber, date: event.date, city, label: FIXED_EVENT_TYPES[event.type].label }] : [];
  });
}

/**
 * The city the traveler is in on trip day `dayNumber`: the first city's days
 * come first, each later city's days start with the transit day into it, and
 * the return day is in the last city.
 */
export function cityOnDay(cities: TripPlan["cities"], dayNumber: number): string {
  let lastDay = 0;
  for (const city of cities) {
    lastDay += city.days;
    if (dayNumber <= lastDay) return city.name;
  }
  return cities[cities.length - 1].name;
}

// Names the model and the traveler may write differently (東京 / 東京都).
const normalizeCity = (name: string) => name.trim().toLowerCase().replace(/[市都府縣县]$/, "");
// Two names this close are the same place to stay in.
const SAME_CITY_KM = 50;

async function isSameCity(a: string, b: string): Promise<boolean> {
  if (normalizeCity(a) === normalizeCity(b)) return true;
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return false;
  const [ca, cb] = await Promise.all([getCityCenter(a, apiKey), getCityCenter(b, apiKey)]);
  return Boolean(ca && cb && haversineKm(ca.lat, ca.lng, cb.lat, cb.lng) <= SAME_CITY_KM);
}

/**
 * Moves days between neighboring cities so each requirement's day falls in
 * its city, when the city is already on the route: the model counts the
 * transit day wrong easily (東京 2, 名古屋 1, 大阪 2 puts 名古屋 on day 3, not
 * day 4). Every city keeps at least a day and the total stays the same. A
 * city that isn't on the route at all is left to a retry.
 */
export function alignCityDays(cities: TripPlan["cities"], requirements: CityRequirement[]): TripPlan["cities"] {
  const days = cities.map((c) => c.days);
  for (const r of requirements) {
    const k = cities.findIndex((c) => normalizeCity(c.name) === normalizeCity(r.city));
    if (k < 0) continue;
    const start = 1 + days.slice(0, k).reduce((a, b) => a + b, 0);
    const end = start + days[k] - 1;
    // Later cities give days to push the city's end out; earlier ones to pull its start in.
    let need = r.dayNumber > end ? r.dayNumber - end : r.dayNumber < start ? start - r.dayNumber : 0;
    const donors = r.dayNumber > end
      ? Array.from({ length: cities.length - k - 1 }, (_, i) => k + 1 + i)
      : Array.from({ length: k }, (_, i) => k - 1 - i);
    for (const j of donors) {
      if (need === 0) break;
      const give = Math.min(need, days[j] - 1);
      days[j] -= give;
      days[k] += give;
      need -= give;
    }
  }
  return days.every((d, i) => d === cities[i].days) ? cities : cities.map((c, i) => ({ ...c, days: days[i] }));
}

/** The requirements a plan misses — the route isn't in the event's city that day. */
export async function unmetCityRequirements(cities: TripPlan["cities"], requirements: CityRequirement[]): Promise<CityRequirement[]> {
  const met = await Promise.all(requirements.map((r) => isSameCity(cityOnDay(cities, r.dayNumber), r.city)));
  return requirements.filter((_, i) => !met[i]);
}

function describeUnmet(unmet: CityRequirement[]): string {
  return (
    unmet.map((r) => `第 ${r.dayNumber} 天（${r.date.slice(5).replace("-", "/")}）的${r.label}在${r.city}`).join("、") +
    "，排不進這趟路線。請調整固定行程的日期或城市，或航班的進出城市後再試一次。"
  );
}

// Same shape as TripPlanSchema but lets a city through with 0 days, so
// rebalanceZeroDayCities() gets a chance to repair it before the strict
// schema rejects the whole response.
const RawTripPlanSchema = TripPlanSchema.extend({
  cities: z
    .array(z.object({ name: z.string().min(1), days: z.number().int().min(0) }))
    .min(1),
  // A loop-length round trip that stays in one city anyway: what the
  // traveler said that asks for it. Without one, the plan is retried.
  stayReason: z.string().optional(),
});

/**
 * Known planTrip failure mode (plan/hybrid-rule-engine-scheduling.md 0.10):
 * the model inserts an extra mid-route city (e.g. Paris -> Geneva -> Rome)
 * and gets the total right, but squeezes the last city down to 0 days. The
 * route itself is fine, so rather than spending the retry on it, move one
 * day to each 0-day city from whichever city currently has the most days.
 * Returns null when there aren't enough days to give every city at least 1.
 */
export function rebalanceZeroDayCities(cities: TripPlan["cities"]): TripPlan["cities"] | null {
  const result = cities.map((city) => ({ ...city }));
  for (const city of result) {
    if (city.days >= 1) continue;
    const donor = result.reduce((max, c) => (c.days > max.days ? c : max));
    if (donor.days <= 1) return null;
    donor.days -= 1;
    city.days += 1;
  }
  return result;
}

function buildSystemPrompt(
  flightInfo: FlightInfo,
  preferences: TripPreferences | undefined,
  totalDays: number,
  requirements: CityRequirement[] = []
): string {
  const arrivalCityName = iataToCity(flightInfo.arrivalCity);
  const returnCityName = iataToCity(flightInfo.returnDepartureCity);
  const isMultiCity = arrivalCityName !== returnCityName;
  const citiesBudget = totalDays - 1;
  const loopAllowed = !isMultiCity && citiesBudget >= LOOP_MIN_DAYS;

  const loopRules = `\n\n【同一城市來回：繞一圈，至少一次兩天一夜】航班從「${arrivalCityName}」進、
也從「${arrivalCityName}」出。這趟天數夠，要從 ${arrivalCityName} 出發，到附近城鎮過夜再回來
（${arrivalCityName} → 鄰近城鎮 → ${arrivalCityName}），讓旅客不必每天都待在同一個城市。規則：
- 第一個和最後一個城市都必須是「${arrivalCityName}」，因為要從這裡搭機回程。回到 ${arrivalCityName} 的
  那一段也要列在 cities 的最後，days 至少 1（回來的移動日），也要算進天數加總
- 中途的城鎮必須在 ${arrivalCityName} 地面交通 3 小時以內，不可以加入需要搭飛機或很遠的城市
- 旅客的風格描述若點名了想去的城鎮，優先安排；沒有的話，就安排 ${arrivalCityName} 周邊最值得過夜的城鎮
- 中途城鎮的 days 填 1 或 2，依城鎮值得玩多久決定。填 1 是兩天一夜：那天移動過去、住一晚，
  隔天移動到下一站（隔天的移動日算在下一站的 days 裡）；填 2 是多住一晚，中間有一整天在當地
- 中途城鎮最多 ${maxLoopTowns(citiesBudget)} 個：每多一個城鎮就多一個移動日，真正觀光的天數會變少
- 只有旅客的風格描述明確表示只想待在 ${arrivalCityName} 時，才只排這一個城市（cities 長度為 1、
  days 等於 ${citiesBudget}），並且在 JSON 多加 "stayReason" 欄位，照抄旅客說的那句話。
  沒有這樣的描述就一定要繞一圈，不要填 stayReason`;

  const singleCityConstraint = `\n\n【重要：這是同一城市來回，絕對只能有一個城市】航班從「${arrivalCityName}」進、
也從「${arrivalCityName}」出，這不是開口式多城市行程。cities 陣列的長度必須恰好是 1，
只能包含「${arrivalCityName}」這一個城市，絕對不可以自己加入同一國家或地區的其他城市
（例如自行加入其他知名城市湊成多城市行程）——即使使用者風格描述沒有明確說「只去一個城市」，
沒有開口式航班就代表整趟行程只在 ${arrivalCityName} 度過。cities[0].days 必須等於 ${citiesBudget}
（唯一一個城市，獨吞全部天數）。`;

  const daysSumExample = `\n\n【天數加總範例】總天數 ${totalDays} 天扣掉最後一天回程日，
你要分配的天數是 ${citiesBudget} 天。範例：若總天數是 ${citiesBudget + 1} 天且只安排一個城市，
該城市的 days 就要填 ${citiesBudget}；若分成兩個城市，兩者的 days 相加也必須等於 ${citiesBudget}
（例如 ${Math.ceil(citiesBudget / 2)} + ${citiesBudget - Math.ceil(citiesBudget / 2)}）。
回傳前務必自己把所有城市的 days 加總一遍，確認等於 ${citiesBudget} 才輸出。`;

  // A later city's days start with the transit day into it — same counting as cityOnDay.
  const requirementRules = requirements.length
    ? `\n\n【固定行程：這幾天必須在指定城市】旅客已經訂好以下行程，那一天一定要待在該城市：
${requirements.map((r) => `- 第 ${r.dayNumber} 天：${r.city}（${r.label}）`).join("\n")}
- 城市不在原本的路線上時，把它加進路線，城市名稱照上面寫的
- 天數計算方式：第一個城市從第 1 天開始；之後每個城市的第一天是移動到該城市的那天。
  例如前一個城市排 3 天（第 1～3 天），下一個城市的第一天就是第 4 天，也就是移動過去的日子
- 回傳前逐一確認：上面每個指定的日子，依你的分配是不是真的落在那個城市`
    : "";

  return `你是專業的旅遊規劃專家。請判斷這趟旅程要去哪些城市、每個城市待幾天——
只需要決定城市清單與天數分配，不需要規劃景點、住宿或餐廳內容。

航班：從 ${arrivalCityName} 進、從 ${returnCityName} 出${isMultiCity ? "（不同城市，開口式行程）" : "（同一城市來回）"}。
總天數：${totalDays} 天，但最後一天固定是回程日（不計入下面的城市天數分配），
你只需要分配前 ${citiesBudget} 天。${buildFlightTimePrompt(flightInfo)}${buildPreferencePrompt(preferences)}
${!isMultiCity ? (loopAllowed ? loopRules : singleCityConstraint) : ""}${requirementRules}${daysSumExample}${UNTRUSTED_INPUT_RULE}

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "title": "行程標題（繁體中文）",
  "currency": "JPY",
  "cities": [
    { "name": "城市名稱（繁體中文）", "days": 3 }
  ]
}

規則：
- title 為這趟行程的標題（繁體中文），簡短反映目的地與風格
- currency 必須填寫，使用目的地當地貨幣的 ISO 4217 代碼（如 JPY、AUD、USD）；
  多城市行程若跨國，以整趟行程主要花費所在地（通常是停留天數最多的國家）為準
- 第一個城市必須是「${arrivalCityName}」。${
    isMultiCity
      ? `最後一個城市必須是「${returnCityName}」；中途可以有其他城市，依使用者風格描述與地理路線合理性決定`
      : loopAllowed
        ? `若繞一圈，最後一個城市也必須是「${arrivalCityName}」，見上方說明`
        : `只能有這一個城市（因為是同一城市來回），見上方【重要】說明，不可以自己加其他城市`
  }
- 每個城市的 days 是整數，代表這個城市總共會用掉的天數：第一個城市的 days
  不含移動日（第1天就是航班抵達當天）；其餘城市的 days 包含抵達它的移動日
- 所有城市的 days 加總必須剛好等於 ${citiesBudget}，見上方【天數加總範例】
- 每一個城市的 days 都至少是 1，${
    isMultiCity ? `包括最後一個城市「${returnCityName}」` : "不可以是 0"
  }。城市數量最多 ${citiesBudget} 個${
    isMultiCity
      ? `。如果在中途加入其他城市，那個城市的天數要從其他城市（通常是停留最久的城市）扣出來，
  絕對不可以把「${returnCityName}」擠成 0 天——例如總共要分配 8 天、原本打算
  「${arrivalCityName} 4 + ${returnCityName} 4」，中途想加一個城市就改成
  「${arrivalCityName} 3 + 中途城市 2 + ${returnCityName} 3」，而不是
  「${arrivalCityName} 5 + 中途城市 3 + ${returnCityName} 0」`
      : ""
  }
- 城市數量、天數分配要符合使用者風格描述（若有）與旅遊常理——不要塞進不合理
  數量的城市，也不要讓單一城市停留時間過短（例如只待 1 天卻要深度體驗）或
  過長而顯得單調
- 城市名稱必須是真實存在、且是航線上地理合理的城市`;
}

/**
 * Makes a loop end back in the arrival city, where the flight home leaves
 * from. The LLM reliably plans the loop itself but often forgets the way back
 * (a Hokkaido run came back ["札幌", "小樽", "登別"] on both attempts, so the
 * whole plan was rejected), so rather than retrying, take one day from the
 * longest stay and add the arrival city at the end. Returns the input
 * unchanged when it already closes, or null when no stay can spare a day.
 */
export function closeLoop(cities: TripPlan["cities"], arrivalCityName: string): TripPlan["cities"] | null {
  if (cities[cities.length - 1].name === arrivalCityName) return cities;
  const donorIdx = cities.reduce((best, c, i) => (c.days > cities[best].days ? i : best), 0);
  if (cities[donorIdx].days < 2) return null;
  return [
    ...cities.map((c, i) => (i === donorIdx ? { ...c, days: c.days - 1 } : c)),
    { name: arrivalCityName, days: 1 },
  ];
}

/**
 * A loop that leaves out the stay back in the arrival city and its days
 * with it: a Sapporo run came back 札幌 3 → 小樽 2 on both attempts, 5 of 6
 * days, so the day-total check rejected the plan before closeLoop could
 * repair it. The missing days become that last stay. Returns the input
 * unchanged when the loop already ends there or nothing is missing.
 */
export function returnLeg(cities: TripPlan["cities"], arrivalCityName: string, daysToAllocate: number): TripPlan["cities"] {
  const missing = daysToAllocate - cities.reduce((sum, c) => sum + c.days, 0);
  if (cities.length < 2 || missing < 1 || cities[cities.length - 1].name === arrivalCityName) return cities;
  return [...cities, { name: arrivalCityName, days: missing }];
}

// Every town on a loop takes a transit day: a 5-day Tokyo run came back
// 東京 1 → 箱根 1 → 鎌倉 1 → 東京 1, leaving one day to sightsee.
export function maxLoopTowns(daysToAllocate: number): number {
  return daysToAllocate >= 7 ? 2 : 1;
}

/**
 * Cuts a loop down to maxLoopTowns towns, keeping those with the most days
 * (the earlier one on a tie) and giving the dropped towns' days to the first
 * city. Like closeLoop, a repair rather than a retry: the route is otherwise
 * fine. Returns the input unchanged when it's within the limit.
 */
export function trimLoopTowns(cities: TripPlan["cities"], arrivalCityName: string, daysToAllocate: number): TripPlan["cities"] {
  const towns = cities.map((c, i) => ({ c, i })).filter(({ c }) => c.name !== arrivalCityName);
  const max = maxLoopTowns(daysToAllocate);
  if (towns.length <= max) return cities;
  const kept = new Set(
    [...towns].sort((a, b) => b.c.days - a.c.days || a.i - b.i).slice(0, max).map(({ i }) => i)
  );
  const freed = towns.filter(({ i }) => !kept.has(i)).reduce((sum, { c }) => sum + c.days, 0);
  const result: TripPlan["cities"] = [];
  cities.forEach((c, i) => {
    if (c.name !== arrivalCityName && !kept.has(i)) return;
    const days = i === 0 ? c.days + freed : c.days;
    const last = result[result.length - 1];
    // Back-to-back stays in the same city once a town between them is gone.
    if (last?.name === c.name) last.days += days;
    else result.push({ ...c, days });
  });
  return result;
}

/**
 * A loop trip's towns must really be near the arrival city — the prompt asks
 * for within 3h by ground, but nothing stops the LLM from adding a city a
 * flight away. Each town is looked up (getCityCenter: cached, and the
 * generators look the same cities up anyway) and if any is unknown or farther
 * than MAX_LOOP_KM, the whole trip falls back to the arrival city alone
 * rather than half-trusting a bad route. Skipped without an API key.
 */
async function keepLoopNearby(
  plan: TripPlan,
  arrivalIata: string,
  arrivalCityName: string,
  daysToAllocate: number
): Promise<TripPlan> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const home = getIataCoords(arrivalIata);
  if (!apiKey || !home) return plan;

  const towns = [...new Set(plan.cities.map((c) => c.name).filter((name) => name !== arrivalCityName))];
  const centers = await Promise.all(towns.map((town) => getCityCenter(town, apiKey).catch(() => null)));
  const tooFar = towns.filter((_town, i) => {
    const center = centers[i];
    return !center || haversineKm(home.lat, home.lng, center.lat, center.lng) > MAX_LOOP_KM;
  });
  if (tooFar.length === 0) return plan;

  console.warn(`[planTrip] loop towns too far from ${arrivalCityName} or not found, staying put:`, tooFar);
  return { ...plan, cities: [{ name: arrivalCityName, days: daysToAllocate }] };
}

/**
 * Decides the city list and per-city day allocation for a from-scratch trip
 * — small, single-purpose call in the same spirit as parsePreferenceIntent():
 * Zod-validated, retried once on any failure (parse error, schema mismatch,
 * or a day total that doesn't add up), never throws. Returns null when both
 * attempts fail — not wired into generate-stream yet (Phase 5(b)/(c) decide
 * the fallback strategy there), so a null here is simply "couldn't plan",
 * left for the caller to handle.
 */
export async function planTrip(
  flightInfo: FlightInfo,
  prompt: string | undefined,
  preferences: TripPreferences | undefined,
  model: string
): Promise<TripPlan | null> {
  const totalDays = calcDays(flightInfo.departureDate, flightInfo.returnDate);
  // A same-day trip has no days left to allocate once the final day is set
  // aside (totalDays - 1 === 0) — TripPlanSchema requires every city to have
  // at least 1 day, so no response could ever satisfy that sum. Skip the
  // call rather than burning two guaranteed-to-fail attempts on it; a
  // single-day trip is entirely covered by generateDepartureDayStops alone.
  if (totalDays <= 1) return null;

  const requirements = cityRequirements(flightInfo, preferences);
  const systemPrompt = buildSystemPrompt(flightInfo, preferences, totalDays, requirements);
  let lastUnmet: CityRequirement[] = [];
  const arrivalCityName = iataToCity(flightInfo.arrivalCity);
  const isRoundTrip = arrivalCityName === iataToCity(flightInfo.returnDepartureCity);
  const loopExpected = isRoundTrip && totalDays - 1 >= LOOP_MIN_DAYS;
  // A valid plan that stayed in one city without the traveler asking —
  // retried once for a loop, and kept if the retry does no better.
  let stayedPut: TripPlan | undefined;
  // The style blurb is caller-controlled, so it rides in the user message as
  // tagged data rather than in the system prompt (see untrustedInput.ts).
  const userMessage =
    `請規劃這趟 ${totalDays} 天行程的城市與天數分配。` +
    (prompt?.trim() ? `\n\n旅客的風格描述：\n${wrapUntrusted(prompt)}` : "");

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });

      const content = completion.choices[0].message.content;
      if (!content) {
        console.warn(`[planTrip] attempt ${attempt}: empty response content`);
        continue;
      }

      const raw = RawTripPlanSchema.safeParse(JSON.parse(content));
      if (!raw.success) {
        console.warn(`[planTrip] attempt ${attempt}: schema validation failed`, content, raw.error.flatten());
        continue;
      }

      const comingBack = returnLeg(raw.data.cities, arrivalCityName, totalDays - 1);
      if (loopExpected && comingBack !== raw.data.cities) {
        console.warn(`[planTrip] attempt ${attempt}: added the way back to ${arrivalCityName}`, raw.data.cities, "->", comingBack);
        raw.data.cities = comingBack;
      }
      const daysSum = raw.data.cities.reduce((sum, city) => sum + city.days, 0);
      if (daysSum !== totalDays - 1) {
        console.warn(
          `[planTrip] attempt ${attempt}: days sum ${daysSum} !== expected ${totalDays - 1}`,
          raw.data
        );
        continue;
      }

      const cities = rebalanceZeroDayCities(raw.data.cities);
      if (!cities) {
        console.warn(`[planTrip] attempt ${attempt}: too many cities to give each at least 1 day`, raw.data);
        continue;
      }
      if (cities.some((city, i) => city.days !== raw.data.cities[i].days)) {
        console.warn(`[planTrip] attempt ${attempt}: rebalanced 0-day cities`, raw.data.cities, "->", cities);
      }

      const parsed = TripPlanSchema.safeParse({ ...raw.data, cities });
      if (!parsed.success) {
        console.warn(`[planTrip] attempt ${attempt}: schema validation failed after rebalance`, parsed.error.flatten());
        continue;
      }

      let plan: TripPlan = parsed.data;
      if (isRoundTrip && parsed.data.cities.length > 1) {
        const names = parsed.data.cities.map((c) => c.name);
        const loop = totalDays - 1 >= LOOP_MIN_DAYS && names[0] === arrivalCityName
          ? closeLoop(parsed.data.cities, arrivalCityName)
          : null;
        if (!loop) {
          console.warn(`[planTrip] attempt ${attempt}: a round trip must stay in or loop back to ${arrivalCityName}`, names);
          continue;
        }
        if (loop !== parsed.data.cities) {
          console.warn(`[planTrip] attempt ${attempt}: closed the loop back to ${arrivalCityName}`, names, "->", loop.map((c) => c.name));
        }
        const trimmed = trimLoopTowns(loop, arrivalCityName, totalDays - 1);
        if (trimmed !== loop) {
          console.warn(`[planTrip] attempt ${attempt}: too many towns for ${totalDays - 1} days`, loop, "->", trimmed);
        }
        plan = await keepLoopNearby({ ...parsed.data, cities: trimmed }, flightInfo.arrivalCity, arrivalCityName, totalDays - 1);
      }

      const aligned = alignCityDays(plan.cities, requirements);
      if (aligned !== plan.cities) {
        console.warn(`[planTrip] attempt ${attempt}: moved days so fixed events fall in their city`, plan.cities, "->", aligned);
        plan = { ...plan, cities: aligned };
      }
      const unmet = await unmetCityRequirements(plan.cities, requirements);
      if (unmet.length > 0) {
        console.warn(`[planTrip] attempt ${attempt}: fixed events in the wrong city`, plan.cities, unmet);
        lastUnmet = unmet;
        continue;
      }
      if (loopExpected && plan.cities.length === 1 && !raw.data.stayReason?.trim()) {
        if (attempt === 1) {
          console.warn(`[planTrip] attempt ${attempt}: stayed in ${arrivalCityName} without the traveler asking, retrying for a night away`);
          stayedPut = plan;
          continue;
        }
        console.warn(`[planTrip] attempt ${attempt}: stayed in ${arrivalCityName} again, keeping it`);
      }
      return plan;
    } catch (err) {
      console.warn(`[planTrip] attempt ${attempt} failed:`, err);
    }
  }

  if (stayedPut) return stayedPut;
  if (lastUnmet.length > 0) throw new FixedEventCityError(describeUnmet(lastUnmet));
  return null;
}

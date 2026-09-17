import { z } from "zod";
import { openai } from "@/lib/openai";
import type { FlightInfo, TripPreferences } from "@/lib/schemas";
import { iataToCity } from "@/lib/iataCity";
import { calcDays, buildFlightTimePrompt, buildPreferencePrompt } from "@/lib/itineraryGen";

// plan/hybrid-rule-engine-scheduling.md Phase 5(a): generate-stream currently
// has no structured city list at all — how many cities and how many days
// each get is decided implicitly, inside the single mega-completion that
// also writes every stop/meal/accommodation. This is the first step of
// pulling that decision out into its own small call, the same way
// parsePreferenceIntent() (preferenceIntent.ts) already separated out
// free-text preference parsing.
export const TripPlanSchema = z.object({
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

function buildSystemPrompt(
  flightInfo: FlightInfo,
  preferences: TripPreferences | undefined,
  prompt: string | undefined,
  totalDays: number
): string {
  const arrivalCityName = iataToCity(flightInfo.arrivalCity);
  const returnCityName = iataToCity(flightInfo.returnDepartureCity);
  const isMultiCity = arrivalCityName !== returnCityName;
  const citiesBudget = totalDays - 1;

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

  return `你是專業的旅遊規劃專家。請判斷這趟旅程要去哪些城市、每個城市待幾天——
只需要決定城市清單與天數分配，不需要規劃景點、住宿或餐廳內容。

航班：從 ${arrivalCityName} 進、從 ${returnCityName} 出${isMultiCity ? "（不同城市，開口式行程）" : "（同一城市來回）"}。
總天數：${totalDays} 天，但最後一天固定是回程日（不計入下面的城市天數分配），
你只需要分配前 ${citiesBudget} 天。${buildFlightTimePrompt(flightInfo)}${buildPreferencePrompt(preferences)}
${prompt?.trim() ? `\n使用者風格描述：${prompt}` : ""}${!isMultiCity ? singleCityConstraint : ""}${daysSumExample}

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "cities": [
    { "name": "城市名稱（繁體中文）", "days": 3 }
  ]
}

規則：
- 第一個城市必須是「${arrivalCityName}」。${
    isMultiCity
      ? `最後一個城市必須是「${returnCityName}」；中途可以有其他城市，依使用者風格描述與地理路線合理性決定`
      : `只能有這一個城市（因為是同一城市來回），見上方【重要】說明，不可以自己加其他城市`
  }
- 每個城市的 days 是整數，代表這個城市總共會用掉的天數：第一個城市的 days
  不含移動日（第1天就是航班抵達當天）；其餘城市的 days 包含抵達它的移動日
- 所有城市的 days 加總必須剛好等於 ${citiesBudget}，見上方【天數加總範例】
- 城市數量、天數分配要符合使用者風格描述（若有）與旅遊常理——不要塞進不合理
  數量的城市，也不要讓單一城市停留時間過短（例如只待 1 天卻要深度體驗）或
  過長而顯得單調
- 城市名稱必須是真實存在、且是航線上地理合理的城市`;
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

  const systemPrompt = buildSystemPrompt(flightInfo, preferences, prompt, totalDays);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `請規劃這趟 ${totalDays} 天行程的城市與天數分配。` },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });

      const content = completion.choices[0].message.content;
      if (!content) {
        console.warn(`[planTrip] attempt ${attempt}: empty response content`);
        continue;
      }

      const parsed = TripPlanSchema.safeParse(JSON.parse(content));
      if (!parsed.success) {
        console.warn(`[planTrip] attempt ${attempt}: schema validation failed`, content, parsed.error.flatten());
        continue;
      }

      const daysSum = parsed.data.cities.reduce((sum, city) => sum + city.days, 0);
      if (daysSum !== totalDays - 1) {
        console.warn(
          `[planTrip] attempt ${attempt}: days sum ${daysSum} !== expected ${totalDays - 1}`,
          parsed.data
        );
        continue;
      }

      return parsed.data;
    } catch (err) {
      console.warn(`[planTrip] attempt ${attempt} failed:`, err);
    }
  }

  return null;
}

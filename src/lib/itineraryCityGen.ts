import { openai } from "@/lib/openai";

// Shared AI-generation helpers for building out a city's worth of itinerary
// content (transit day, sightseeing days, accommodation + meals). Originally
// lived only in batch-insert-waypoints/route.ts; factored out so the
// restructure endpoint can generate new-city content the same way instead of
// duplicating these prompts.

export async function generateTransitDayStops(
  fromCity: string,
  toCity: string,
  currency: string
): Promise<Array<Record<string, unknown>>> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `你是專業的旅遊規劃專家。請為旅行者規劃一個從 ${fromCity || "出發地"} 前往 ${toCity} 的移動日行程。

【重要】請先評估兩城市之間的實際地理距離與交通時間，再規劃行程（涵蓋各大洲的城市對，依實際距離判斷，不要只套用單一地區的直覺）：
- 短程（車程＜90 分鐘，如大阪→京都 30min、東京→橫濱 30min、布拉格→布拉迪斯拉發 1hr）：抵達後幾乎是一整個白天都空著，務必安排 2-4 個抵達城市的真實熱門景點填滿下午（甚至傍晚），不可只寫「入住/晚餐」帶過
- 中程（車程 90 分鐘－4 小時，如維也納→布達佩斯 2.5hr、大阪→廣島 1.5hr）：抵達後仍有半天，安排 1-2 個抵達城市的真實景點；若抵達已近傍晚則僅安排晚餐
- 長程（車程＞4 小時或需過夜，如布達佩斯→捷克克魯姆洛夫 8-11hr）：交通佔全天，抵達已是傍晚甚至深夜，不安排觀光，只需 Check-in 或附近晚餐

抵達時間必須用「出發時間＋交通 stop 的 duration_minutes」實際推算，不可憑感覺寫「已是下午/晚上」——如果推算出抵達時間是上午或中午，就必須安排下午的真實景點，不能用长程模板的措辭。

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "stops": [
    {
      "name": "景點或活動名稱（繁體中文）",
      "description": "描述（繁體中文，1-2 句話）",
      "duration_minutes": 60,
      "time_of_day": "morning",
      "transport_from_prev": "交通方式",
      "estimated_cost": 0
    }
  ]
}

規則：
- 依序為：
  1. ${fromCity ? `${fromCity} 出發前早晨微行程（車站附近早餐或快速景點，09:30 前完成，time_of_day: "morning"）` : `出發準備（time_of_day: "morning"）`}
  2. 交通本身（須填入真實交通工具、實際出發/抵達時間、正確車程時數，duration_minutes 必須反映真實車程）
  3. 抵達後活動（依上方短/中/長程規則決定要安排幾個真實景點，短程至少 2 個，中程 1-2 個，長程 1 個 check-in/晚餐）
- 除了短程規則要求的多個景點外，總 stop 數不設死上限，依實際可安排內容決定
- time_of_day 只能是 "morning"、"afternoon"、"evening" 之一
- duration_minutes 為整數（分鐘），交通 stop 必須填入真實車程分鐘數
- estimated_cost 為 ${currency} 整數，免費填 0
- 所有地點必須真實存在`,
      },
      {
        role: "user",
        content: `請規劃從 ${fromCity || "出發地"} 前往 ${toCity} 的移動日行程。`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0].message.content;
  if (!content) return [];
  const parsed = JSON.parse(content) as { stops?: unknown[] };
  if (!Array.isArray(parsed.stops)) return [];
  return parsed.stops.map((s) => ({
    ...(s as Record<string, unknown>),
    id: crypto.randomUUID(),
  }));
}

export async function generateMealsAndAccommodation(
  cityName: string,
  stayDays: number,
  currency: string
): Promise<{ accommodation: Record<string, unknown>; mealsByDay: Array<Record<string, unknown>> }> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `你是專業的旅遊規劃專家。請為旅行者在 ${cityName} 停留 ${stayDays} 天的行程推薦住宿和每日四餐（早餐、午餐、晚餐、點心）。

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "accommodation": { "name": "住宿名稱（使用原文或英文）", "area": "所在區域" },
  "meals": [
    {
      "breakfast": { "name": "餐廳名稱", "description": "一句話簡介", "estimated_cost": 0 },
      "lunch": { "name": "餐廳名稱", "description": "一句話簡介", "estimated_cost": 0 },
      "dinner": { "name": "餐廳名稱", "description": "一句話簡介", "estimated_cost": 0 },
      "snack": { "name": "咖啡館或甜點店名稱", "description": "一句話簡介", "estimated_cost": 0 }
    }
  ]
}

規則：
- accommodation 為整個在 ${cityName} 停留期間的住宿，必須是真實存在且可在 Booking.com 找到的飯店
- meals 陣列共 ${stayDays} 個元素，每天推薦不同的餐廳
- 所有餐廳必須是 ${cityName} 真實存在的知名店家；snack 須為咖啡館、甜點店或冰淇淋店，不可填正餐型餐廳
- estimated_cost 為 ${currency} 整數，代表每人平均消費`,
      },
      {
        role: "user",
        content: `請為旅行者在 ${cityName} 停留 ${stayDays} 天推薦住宿和每日四餐（早餐、午餐、晚餐、點心）。`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0].message.content;
  if (!content) return { accommodation: {}, mealsByDay: Array.from({ length: stayDays }, () => ({})) };

  const parsed = JSON.parse(content) as {
    accommodation?: Record<string, unknown>;
    meals?: Array<Record<string, unknown>>;
  };
  return {
    accommodation: parsed.accommodation ?? {},
    mealsByDay: Array.from({ length: stayDays }, (_, i) => parsed.meals?.[i] ?? {}),
  };
}

export async function generateDayStops(
  cityName: string,
  stayDays: number,
  currency: string
): Promise<Array<Array<Record<string, unknown>>>> {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `你是專業的旅遊規劃專家。請為旅行者規劃在 ${cityName} 停留 ${stayDays} 天的景點行程。

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "days": [
    {
      "stops": [
        {
          "name": "景點名稱（繁體中文）",
          "description": "景點描述（繁體中文，1-2 句話）",
          "duration_minutes": 120,
          "time_of_day": "morning",
          "transport_from_prev": "從上一個景點的交通方式描述",
          "estimated_cost": 0
        }
      ]
    }
  ]
}

規則：
- 共生成 ${stayDays} 天，每天 3-4 個景點
- time_of_day 只能是 "morning"、"afternoon"、"evening" 之一
- duration_minutes 為整數（分鐘）
- estimated_cost 為 ${currency} 貨幣的整數，免費景點填 0
- transport_from_prev 描述如何從上一個景點抵達
- 所有景點必須是 ${cityName} 真實存在的知名地點`,
      },
      {
        role: "user",
        content: `請規劃 ${cityName} 停留 ${stayDays} 天的景點行程。`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.7,
  });

  const content = completion.choices[0].message.content;
  if (!content) return Array.from({ length: stayDays }, () => []);

  const parsed = JSON.parse(content) as { days?: Array<{ stops?: unknown[] }> };
  const aiDays = parsed.days ?? [];

  return Array.from({ length: stayDays }, (_, i) => {
    const stops = aiDays[i]?.stops;
    if (!Array.isArray(stops)) return [];
    return stops.map((stop) => ({
      ...(stop as Record<string, unknown>),
      id: crypto.randomUUID(),
    }));
  });
}

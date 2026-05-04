import { openai } from "@/lib/openai";
import { ItinerarySchema, FlightInfoSchema, TripPreferencesSchema, type FlightInfo, type TripPreferences } from "@/lib/schemas";
import { prisma, j } from "@/lib/db";

const paceMap: Record<string, string> = {
  relaxed: "悠閒，每天景點不超過 3 個，留有充足休息時間",
  moderate: "適中，每天安排 3-4 個景點",
  intensive: "緊湊，每天安排 5 個以上景點，行程滿檔",
};

const budgetMap: Record<string, string> = {
  budget: "經濟實惠，偏好免費或低消費景點、平價餐廳",
  moderate: "中等消費，一般觀光景點與餐廳",
  luxury: "高端奢華，頂級餐廳、精品購物、私人導覽",
};

const interestMap: Record<string, string> = {
  food: "美食",
  culture: "文化歷史",
  nature: "自然景觀",
  shopping: "購物",
  adventure: "冒險戶外活動",
};

function calcDays(departureDate: string, returnDate: string): number {
  const dep = new Date(departureDate);
  const ret = new Date(returnDate);
  return Math.max(1, Math.ceil((ret.getTime() - dep.getTime()) / (1000 * 60 * 60 * 24)));
}

function buildFlightTimePrompt(flightInfo: FlightInfo): string {
  const lines: string[] = [];
  if (flightInfo.arrivalTime) {
    lines.push(`去程航班預計 ${flightInfo.arrivalTime} 抵達目的地，第 1 天行程需在抵達後合理時間（含入境、提領行李、前往市區）才開始。`);
  }
  if (flightInfo.returnDepartureTime) {
    lines.push(`回程航班預計 ${flightInfo.returnDepartureTime} 出發，最後一天行程必須在此時間至少 3 小時前結束，以預留前往機場及辦理登機手續的時間。`);
  }
  return lines.length ? "\n\n航班時間限制：\n" + lines.join("\n") : "";
}

function buildPreferencePrompt(preferences?: TripPreferences): string {
  if (!preferences) return "";
  const lines: string[] = [];
  if (preferences.pace) lines.push(`行程步調：${paceMap[preferences.pace]}。`);
  if (preferences.budget) lines.push(`預算級別：${budgetMap[preferences.budget]}。`);
  if (preferences.interests?.length) {
    const labels = preferences.interests.map((i) => interestMap[i]).join("、");
    lines.push(`旅遊偏好：以${labels}為主。`);
  }
  return lines.length ? "\n\n使用者偏好：\n" + lines.join("\n") : "";
}

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

async function ensureDemoUser() {
  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: {
      id: DEMO_USER_ID,
      email: "demo@ai-travel-agent.dev",
      name: "Demo User",
    },
  });
}

function addIdsToItinerary(data: ReturnType<typeof ItinerarySchema.parse>) {
  return {
    ...data,
    days: data.days.map((day) => ({
      ...day,
      id: crypto.randomUUID(),
      stops: day.stops.map((stop, stopIdx) => ({
        ...stop,
        id: crypto.randomUUID(),
        orderIndex: stopIdx,
      })),
    })),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { prompt, flightInfo: rawFlightInfo, preferences: rawPreferences } = body;

    if (!rawFlightInfo) {
      return new Response("Missing flightInfo", { status: 400 });
    }

    const flightInfo: FlightInfo = FlightInfoSchema.parse(rawFlightInfo);
    const days = calcDays(flightInfo.departureDate, flightInfo.returnDate);

    const preferences = rawPreferences
      ? TripPreferencesSchema.parse(rawPreferences)
      : undefined;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const isMultiCity = flightInfo.returnDepartureCity !== flightInfo.arrivalCity;
          const routeDesc = isMultiCity
            ? `從 ${flightInfo.departureCity} 出發飛往 ${flightInfo.arrivalCity}，旅途結束後從 ${flightInfo.returnDepartureCity} 搭機返回`
            : `從 ${flightInfo.departureCity} 出發飛往 ${flightInfo.arrivalCity} 來回`;

          const systemPrompt = `你是專業的旅遊規劃專家。請為用戶規劃 ${days} 天的旅遊行程。
航班資訊：${routeDesc}。
出發日期：${flightInfo.departureDate}，回程日期：${flightInfo.returnDate}。
第 1 天對應 ${flightInfo.departureDate}，以此類推。${isMultiCity ? `\n最後一天的住宿與景點應位於 ${flightInfo.returnDepartureCity} 附近，以便搭乘回程班機。` : ""}${buildFlightTimePrompt(flightInfo)}${buildPreferencePrompt(preferences)}

嚴格遵守以下 JSON 結構：
{
  "title": "行程標題（繁體中文）",
  "currency": "JPY",
  "days": [
    {
      "day": 1,
      "theme": "主題（可選，繁體中文）",
      "stops": [
        {
          "name": "景點名稱",
          "description": "景點描述",
          "duration_minutes": 180,
          "time_of_day": "morning",
          "transport_from_prev": "從機場搭乘地鐵約 30 分鐘",
          "estimated_cost": 1500
        }
      ],
      "accommodation": {
        "name": "住宿名稱",
        "area": "住宿區域"
      },
      "meals": {
        "breakfast": { "name": "早餐店名稱", "description": "簡短描述", "estimated_cost": 12 },
        "lunch": { "name": "午餐店名稱", "description": "簡短描述", "estimated_cost": 20 },
        "dinner": { "name": "晚餐店名稱", "description": "簡短描述", "estimated_cost": 35 }
      }
    }
  ]
}

重要規則：
1. JSON Key 必須是英文
2. 所有 Value（景點名稱、描述、主題、住宿、交通描述）必須使用繁體中文；currency 例外，使用 ISO 4217 貨幣代碼（如 JPY、AUD、USD）
3. day 從 1 開始計數
4. duration_minutes 必須是數字（分鐘）
5. 每天至少要有 2 個景點，每天 3-5 個景點為佳
6. 所有景點與住宿必須實際位於旅遊目的地範圍內（${isMultiCity ? `${flightInfo.arrivalCity} 至 ${flightInfo.returnDepartureCity} 沿途地區` : flightInfo.arrivalCity}），嚴禁加入範圍以外的地點
7. accommodation 為每天的住宿建議，必須填寫
8. time_of_day 必須填寫，值只能是 "morning"（早上）、"afternoon"（下午）、"evening"（晚上）之一，每天景點應合理分配至早中晚三個時段
9. transport_from_prev 必須填寫，描述如何從上一個景點（或住宿、機場）前往此景點，例如「步行約 10 分鐘」、「搭乘地鐵約 15 分鐘」、「搭計程車約 20 分鐘」；第 1 天第一個景點填寫從機場前往的交通方式，其他天第一個景點填寫從住宿前往的交通方式
10. currency 必須填寫，使用目的地當地貨幣的 ISO 4217 代碼
11. estimated_cost 必須填寫，為該景點的預估花費（門票、餐飲、活動費用等），以 currency 為單位的整數；免費景點填 0
12. meals 必須填寫，早餐、午餐、晚餐各推薦一家當地實際存在的餐廳；name 為餐廳名稱，description 為一句話簡介（風格、招牌菜等），estimated_cost 為每人平均消費（以 currency 為單位的整數）`;

          const destinationDesc = isMultiCity
            ? `${flightInfo.arrivalCity} → ${flightInfo.returnDepartureCity}`
            : flightInfo.arrivalCity;
          const userContent = prompt?.trim()
            ? `請規劃行程，風格描述：${prompt}`
            : `請規劃 ${destinationDesc} ${days} 天行程`;

          const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
            max_tokens: 16000,
            stream: true,
          });

          let accumulatedContent = "";

          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              accumulatedContent += content;
              const data = JSON.stringify({
                type: "chunk",
                content: accumulatedContent,
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
          }

          try {
            const parsedData = JSON.parse(accumulatedContent);
            const validatedData = ItinerarySchema.parse(parsedData);
            const dataWithIds = addIdsToItinerary(validatedData);

            let savedId: string | null = null;
            try {
              await ensureDemoUser();
              const saved = await prisma.itinerary.create({
                data: {
                  userId: DEMO_USER_ID,
                  title: validatedData.title,
                  days: j(dataWithIds.days),
                  config: j({
                    generatedWith: prompt ?? "",
                    totalDays: days,
                    createdAt: new Date().toISOString(),
                    isStreamed: true,
                    flightInfo,
                    preferences: preferences ?? null,
                  }),
                },
              });
              savedId = saved.id;
              console.log(`[Stream] Itinerary saved: ${savedId}`);
            } catch (dbError) {
              console.error("[DB Save Error]", dbError);
            }

            const finalData = JSON.stringify({
              type: "complete",
              data: validatedData,
              id: savedId,
            });
            controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
          } catch (error) {
            const errorData = JSON.stringify({
              type: "error",
              error: "資料格式驗證失敗",
              details: error instanceof Error ? error.message : String(error),
            });
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          }

          controller.close();
        } catch (error) {
          const errorData = JSON.stringify({
            type: "error",
            error: "生成失敗",
            details: error instanceof Error ? error.message : String(error),
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Stream Error]", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

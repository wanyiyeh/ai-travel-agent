import { openai } from "@/lib/openai";
import { ItinerarySchema, TripPreferencesSchema, type TripPreferences } from "@/lib/schemas";
import { prisma } from "@/lib/db";

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
    const { prompt, days, preferences: rawPreferences } = body;

    if (!prompt || !days) {
      return new Response("Missing prompt or days", { status: 400 });
    }

    const preferences = rawPreferences
      ? TripPreferencesSchema.parse(rawPreferences)
      : undefined;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const systemPrompt = `你是專業的旅遊規劃專家。請為用戶規劃 ${days} 天的旅遊行程。${buildPreferencePrompt(preferences)}

嚴格遵守以下 JSON 結構：
{
  "title": "行程標題（繁體中文）",
  "days": [
    {
      "day": 1,
      "theme": "主題（可選，繁體中文）",
      "stops": [
        {
          "name": "景點名稱",
          "description": "景點描述",
          "duration_minutes": 180
        }
      ]
    }
  ]
}

重要規則：
1. JSON Key 必須是英文
2. 所有 Value（景點名稱、描述、主題）必須使用繁體中文
3. day 從 1 開始計數
4. duration_minutes 必須是數字（分鐘）
5. 每天至少要有 2 個景點，每天 3-5 個景點為佳`;

          const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `請為以下需求創建旅遊行程：${prompt}`,
              },
            ],
            response_format: { type: "json_object" },
            temperature: 0.7,
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
                  days: dataWithIds.days as object[],
                  config: {
                    generatedWith: prompt,
                    totalDays: days,
                    createdAt: new Date().toISOString(),
                    isStreamed: true,
                    preferences: preferences ?? null,
                  },
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
              details:
                error instanceof Error ? error.message : String(error),
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

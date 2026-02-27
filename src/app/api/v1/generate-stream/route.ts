import { openai } from "@/lib/openai";
import { ItinerarySchema } from "@/lib/schemas";
import { prisma } from "@/lib/db";

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
    const { prompt, days } = body;

    if (!prompt || !days) {
      return new Response("Missing prompt or days", { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const systemPrompt = `你是專業的旅遊規劃專家。請為用戶規劃 ${days} 天的旅遊行程。

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

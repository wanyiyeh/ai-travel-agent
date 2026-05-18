import { NextResponse } from "next/server";
import { z } from "zod";
import { openai } from "@/lib/openai";
import { TransitRecommendationSchema } from "@/lib/schemas";

const RequestSchema = z.object({
  originIata: z.string().regex(/^[A-Z]{3}$/),
  destinationIata: z.string().regex(/^[A-Z]{3}$/),
  existingStops: z.array(z.string().min(1)).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { originIata, destinationIata, existingStops } = parsed.data;
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `你是資深的自助旅行專家。當旅行者持有「甲地進、乙地出」的機票時，請推薦 3 至 5 個值得順路停留的目的地，可以是城市或整個國家。${existingStops?.length ? `\n\n【重要】以下城市／機場已包含在行程中，請勿重複推薦：${existingStops.join(", ")}` : ""}

回傳嚴格的 JSON 格式（不要其他文字）：
{
  "recommendations": [
    {
      "name": "<目的地名稱（英文）>",
      "type": "<\"city\" 或 \"country\"，城市填 city，整個國家填 country>",
      "country": "<所屬國家名稱（中文）>",
      "iataCode": "<代表性機場 IATA 代號，若有>",
      "transitTimeHours": <從起點搭火車/巴士/飛機的預估時數，數字>,
      "transitMode": "<主要交通方式，例如：高速火車、巴士、廉航、渡輪>",
      "suggestedStayDaysMin": <建議最少停留天數，整數>,
      "suggestedStayDaysMax": <建議最多停留天數，整數>,
      "popularity": "<high | medium | low>",
      "topAttractions": ["<景點或城市1>", "<景點或城市2>", "<景點或城市3>"],
      "lat": <代表性緯度，數字>,
      "lng": <代表性經度，數字>
    }
  ]
}

推薦標準：
- 地理位置需位於起訖兩點的合理路線上或附近
- 可以推薦單一城市（type: city），也可以推薦整個值得走訪的國家（type: country）
- 若推薦整個國家，topAttractions 填入該國 3 個最值得走訪的城市或景點
- 優先推薦有完善大眾交通連結的目的地
- 依照受歡迎程度排序（最熱門的排前面）
- topAttractions 必須是 3 個且為真實存在的知名地點`,
        },
        {
          role: "user",
          content: `機票資訊：從 ${originIata} 出發，在 ${destinationIata} 結束。
請推薦這兩個機場之間，值得順路拜訪的城市或國家（3 到 5 個）。`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
    });

    const aiContent = completion.choices[0].message.content;
    if (!aiContent) throw new Error("AI returned empty response");

    const raw = JSON.parse(aiContent) as { recommendations: unknown[] };
    const recommendations = raw.recommendations
      .map((item) => TransitRecommendationSchema.safeParse(item))
      .filter((r) => r.success)
      .map((r) => r.data!);

    return NextResponse.json({ recommendations });
  } catch (error) {
    console.error("[Transit Recommendations Error]", error);
    return NextResponse.json(
      { error: "Failed to get transit recommendations", details: String(error) },
      { status: 500 }
    );
  }
}

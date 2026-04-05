import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { openai } from "@/lib/openai";
import { ItinerarySchema, TripPreferencesSchema, type TripPreferences } from "@/lib/schemas";

const RequestSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  days: z.number().int().min(1).max(14),
  userId: z.string().optional(),
  preferences: TripPreferencesSchema.optional(),
});

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
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { prompt, days, userId, preferences } = parsed.data;
    const resolvedUserId = userId ?? DEMO_USER_ID;

    if (!userId) {
      await ensureDemoUser();
    }

    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    console.log(
      `[AI] Generating for: ${prompt} (${days} days) model: ${model}`
    );

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `你是專業的旅遊規劃專家。Always respond in Traditional Chinese (繁體中文).
Output strictly valid JSON matching this schema for ${days} days:
{ title: string, days: [{ day: number, theme?: string, stops: [{ name: string, description: string, duration_minutes: number }] }] }
day starts from 1. duration_minutes is a number (minutes).${buildPreferencePrompt(preferences)}`,
        },
        {
          role: "user",
          content: `Create a trip for: ${prompt}.`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const aiContent = completion.choices[0].message.content;
    if (!aiContent) throw new Error("AI returned empty response");

    const parsedAI = ItinerarySchema.safeParse(JSON.parse(aiContent));
    if (!parsedAI.success) {
      throw new Error(
        `AI response validation failed: ${parsedAI.error.message}`
      );
    }

    const validatedData = parsedAI.data;
    const dataWithIds = addIdsToItinerary(validatedData);

    const newItinerary = await prisma.itinerary.create({
      data: {
        userId: resolvedUserId,
        title: validatedData.title,
        days: dataWithIds.days as object[],
        config: {
          generatedWith: prompt,
          totalDays: days,
          createdAt: new Date().toISOString(),
          preferences: preferences ?? null,
        },
      },
    });

    return NextResponse.json({
      message: "Itinerary generated",
      id: newItinerary.id,
      data: validatedData,
    });
  } catch (error) {
    console.error("[Generate Error]", error);
    return NextResponse.json(
      { error: "Failed to generate", details: String(error) },
      { status: 500 }
    );
  }
}

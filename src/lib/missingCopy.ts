import { z } from "zod";
import { openai } from "@/lib/openai";
import { COPY_PENDING } from "@/lib/copyPending";

// 補介紹: places the program put in itself — a coffee shop rotated in for the
// snack, lunch near a day trip, 鎌倉大佛 on a classic day trip, an evening
// illumination — never went through the copy-writing call, so they showed up
// with no description, or only a practical note (「傍晚搭火車回東京」). Once
// the whole trip is assembled, they all go to the model in one call for a
// line each; the program's own note stays after it.

type Rec = Record<string, unknown>;

const MEAL_SLOTS: Record<string, string> = { breakfast: "早餐", lunch: "午餐", snack: "點心", dinner: "晚餐", nightcap: "小酌" };
// Plenty for a long trip; past this the rest keep what they have.
const MAX_ITEMS = 60;

type Target = { item: Rec; kind: string; city: string };

/**
 * Real places with nothing written about them yet. A booked event (固定行程)
 * or a car pickup keeps its own practical description.
 */
export function needsCopy(item: unknown): item is Rec {
  if (!item || typeof item !== "object") return false;
  const rec = item as Rec;
  if (typeof rec.name !== "string" || typeof rec.placeId !== "string" || rec.fixedEvent) return false;
  return rec[COPY_PENDING] === true || typeof rec.description !== "string" || rec.description.trim() === "";
}

export function collectCopyTargets(days: Rec[]): Target[] {
  const targets: Target[] = [];
  for (const day of days) {
    const city = typeof day.waypointCity === "string" ? day.waypointCity : "";
    for (const stop of Array.isArray(day.stops) ? day.stops : []) {
      if (needsCopy(stop)) targets.push({ item: stop, kind: "景點", city });
    }
    const meals = (day.meals ?? {}) as Rec;
    for (const [slot, label] of Object.entries(MEAL_SLOTS)) {
      if (needsCopy(meals[slot])) targets.push({ item: meals[slot] as Rec, kind: label, city });
    }
  }
  return targets.slice(0, MAX_ITEMS);
}

/** The model's line, then the program's note: 「鎌倉的象徵…。傍晚搭火車回東京」. */
export function withCopy(copy: string, note: unknown): string {
  const line = copy.trim().replace(/[。.]$/, "");
  const rest = typeof note === "string" ? note.trim() : "";
  return rest ? `${line}。${rest}` : `${line}。`;
}

const CopySchema = z.object({ copy: z.record(z.string(), z.string()) });

const SYSTEM_PROMPT = `你是旅遊行程的文案助手。下面每一行是一個地點：編號、類別、城市、名稱。
請為每個地點寫一句繁體中文介紹（20～40 字），讓旅客知道這裡值得去的原因或特色。

規則：
- 只寫一般人熟知的特色，不要編造營業時間、價格、排隊時間這類具體數字
- 不確定這個地點的細節時，依名稱和類別寫一句概括的介紹，不要硬編
- 餐廳寫它的料理類型或風格；景點寫它的看點

回傳嚴格的 JSON（不要其他文字）：{ "copy": { "編號": "介紹" } }`;

/**
 * Writes a line for every place still without one (one call for the whole
 * trip) and drops the copy-pending marks. Never throws: on any failure the
 * places keep what they had.
 */
export async function fillMissingCopy(days: Rec[], model: string): Promise<void> {
  const targets = collectCopyTargets(days);
  try {
    if (targets.length === 0) return;
    const lines = targets.map((t, i) => `${i}｜${t.kind}｜${t.city}｜${String(t.item.name)}`);
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: lines.join("\n") },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    });
    const content = completion.choices[0].message.content;
    const parsed = content ? CopySchema.safeParse(JSON.parse(content)) : undefined;
    if (!parsed?.success) {
      console.warn("[missingCopy] no usable copy", content);
      return;
    }
    targets.forEach((t, i) => {
      const copy = parsed.data.copy[String(i)];
      if (copy?.trim()) t.item.description = withCopy(copy, t.item.description);
    });
  } catch (err) {
    console.warn("[missingCopy] failed", err);
  } finally {
    for (const day of days) {
      for (const stop of Array.isArray(day.stops) ? day.stops : []) delete (stop as Rec)[COPY_PENDING];
      for (const meal of Object.values((day.meals ?? {}) as Rec)) {
        if (meal && typeof meal === "object") delete (meal as Rec)[COPY_PENDING];
      }
    }
  }
}

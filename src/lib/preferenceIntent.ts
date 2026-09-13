import { openai } from "@/lib/openai";
import {
  NEUTRAL_PREFERENCE_INTENT,
  PreferenceIntentSchema,
  type PreferenceIntent,
} from "@/lib/schemas";

const SYSTEM_PROMPT = `你是旅遊行程規劃助手的偏好解析器。使用者會輸入一段關於行程偏好的自由文字（中文或英文皆可），
你的任務是把它轉換成結構化 JSON，不要生成任何行程內容，只做解析。

Output strictly valid JSON with exactly these keys:
{
  "pace": "relaxed" | "moderate" | "intensive" | null,
  "startTimePreference": "early" | "normal" | "late" | null,
  "interestBoost": string[],
  "dietaryRestrictions": string[],
  "avoid": string[]
}

規則：
- "pace"：提到想放鬆、悠閒、慢慢玩 → "relaxed"；想多排一點、緊湊、充實 → "intensive"；沒提到步調 → null。
- "startTimePreference"：提到想早起、早點出門 → "early"；想晚點出門、不想早起、想睡晚一點 → "late"；沒提到 → null。
- "interestBoost"：使用者特別想加強的興趣類別，用簡短英文 snake_case 標籤，例如
  "local_food"、"history"、"nature"、"shopping"、"nightlife"、"art"、"architecture"。沒有就回傳空陣列。
- "dietaryRestrictions"：飲食限制，用簡短英文 snake_case 標籤，例如
  "vegetarian"、"vegan"、"halal"、"no_seafood"、"gluten_free"。沒有就回傳空陣列。
- "avoid"：明確想避開的事物，用簡短英文 snake_case 標籤，例如
  "long_walks"、"crowds"、"long_queues"、"early_mornings"。沒有就回傳空陣列。
- 只輸出 JSON，不要加任何說明文字或註解。`;

/**
 * Parses a free-text preference blurb into a structured PreferenceIntent via
 * a small, single-purpose LLM call — kept separate from the main itinerary
 * generation prompt so it can be tested and debugged independently
 * (plan/hybrid-rule-engine-scheduling.md, Phase 1). Never throws: any
 * failure (empty input, bad JSON, schema mismatch, API error) falls back to
 * NEUTRAL_PREFERENCE_INTENT, so a parsing failure never blocks generation.
 */
export async function parsePreferenceIntent(
  freeText: string,
  model: string
): Promise<PreferenceIntent> {
  const trimmed = freeText.trim();
  if (!trimmed) return NEUTRAL_PREFERENCE_INTENT;

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: trimmed },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0].message.content;
    if (!content) return NEUTRAL_PREFERENCE_INTENT;

    const parsed = PreferenceIntentSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : NEUTRAL_PREFERENCE_INTENT;
  } catch {
    return NEUTRAL_PREFERENCE_INTENT;
  }
}

import { openai } from "@/lib/openai";
import { SkeletonCopySchema, type SkeletonCopy, type PreferenceIntent } from "@/lib/schemas";
import type { SkeletonStop } from "@/lib/scheduler/buildDaySkeleton";
import type { RestaurantHint } from "@/lib/fetchCityRestaurants";

const PACE_LABEL: Record<NonNullable<PreferenceIntent["pace"]>, string> = {
  relaxed: "步調放鬆、悠閒",
  moderate: "步調適中",
  intensive: "步調緊湊、想多體驗",
};

function buildSystemPrompt(): string {
  return `你是旅遊行程規劃助手的文案生成器。時段、順序、地點都已經由系統排定好了，
你的任務**只有**幫每個景點寫一句簡短的中文描述（description）和選填的一句亮點
（highlight），以及幫這一天下一個主題句（dayTheme，選填）。

嚴格規則：
- 只能用「給定的 stop id」當 key 回傳，不可以自己發明 id、不可以新增/刪除/合併任何
  景點、不可以回傳時間、順序、地點、placeId 等任何非文字欄位——這些都已經確定，
  你只負責補文字。
- description 要具體描述這個景點本身，不要空泛（例如避免「值得一去的好地方」這種話）。
- 不要提到「規則引擎」「系統排定」等內部術語，寫得自然像真人旅遊文案。
- 只輸出 JSON，不要加任何說明文字或註解。

Output strictly valid JSON matching this schema:
{ "dayTheme": string (optional), "stops": { "<stop id>": { "description": string, "highlight": string (optional) } } }`;
}

function buildUserPrompt(
  skeleton: SkeletonStop[],
  hintById: Map<string, RestaurantHint>,
  preferenceIntent: PreferenceIntent,
  cityName?: string
): string {
  const stopLines = skeleton
    .map((s) => {
      const name = hintById.get(s.id)?.name ?? s.id;
      return `- id="${s.id}"：${name}（${s.time_of_day}，停留約 ${s.estimatedDurationMinutes} 分鐘）`;
    })
    .join("\n");

  const preferenceLines: string[] = [];
  if (preferenceIntent.pace) preferenceLines.push(PACE_LABEL[preferenceIntent.pace]);
  if (preferenceIntent.interestBoost.length > 0) {
    preferenceLines.push(`特別喜歡：${preferenceIntent.interestBoost.join("、")}`);
  }
  if (preferenceIntent.avoid.length > 0) {
    preferenceLines.push(`想避開：${preferenceIntent.avoid.join("、")}`);
  }

  return `${cityName ? `城市：${cityName}\n` : ""}今天的景點行程（依時間順序）：
${stopLines}
${preferenceLines.length > 0 ? `\n使用者偏好：${preferenceLines.join("；")}` : ""}

請幫以上每個景點寫 description（和選填的 highlight），並選填一句今天的主題句。`;
}

// Fallback used both when the whole call fails and to backfill any stop id
// the model's response left out — every stop always gets *some* text rather
// than an empty description reaching the UI.
function fallbackDescription(hint: RestaurantHint | undefined, id: string): string {
  return hint?.name ? `前往 ${hint.name}。` : `前往下一個景點（${id}）。`;
}

/**
 * Fills in text-only copy (per-stop description/highlight, day theme) for an
 * already-built rule-engine skeleton — the LLM here cannot alter time, order,
 * or location, only supply the fields plan/hybrid-rule-engine-scheduling.md
 * section 4b calls for. Small, single-purpose call in the same spirit as
 * parsePreferenceIntent(): never throws, and the returned `stops` record is
 * guaranteed to cover every id in `skeleton` — a schema-invalid or partial
 * response degrades individual stops to a generic fallback instead of
 * blocking the whole day.
 */
export async function generateSkeletonCopy(
  skeleton: SkeletonStop[],
  hintById: Map<string, RestaurantHint>,
  preferenceIntent: PreferenceIntent,
  model: string,
  cityName?: string
): Promise<SkeletonCopy> {
  const fallbackStops: SkeletonCopy["stops"] = {};
  for (const s of skeleton) fallbackStops[s.id] = { description: fallbackDescription(hintById.get(s.id), s.id) };

  if (skeleton.length === 0) return { stops: {} };

  let parsed: SkeletonCopy | undefined;
  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(skeleton, hintById, preferenceIntent, cityName) },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0].message.content;
    if (content) {
      const result = SkeletonCopySchema.safeParse(JSON.parse(content));
      if (result.success) parsed = result.data;
    }
  } catch {
    // fall through to the fallback-only result below
  }

  // Merge: real copy where the model gave it, fallback for every id it
  // missed (never a hard failure just because one stop got skipped).
  const stops: SkeletonCopy["stops"] = {};
  for (const s of skeleton) {
    stops[s.id] = parsed?.stops[s.id] ?? fallbackStops[s.id];
  }

  return { dayTheme: parsed?.dayTheme, stops };
}

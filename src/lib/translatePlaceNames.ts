import { openai } from "@/lib/openai";

/**
 * Batch-translate place display names (hotels, restaurants, cafés, etc.) into
 * Traditional Chinese for display. Google Places' zh-TW languageCode only
 * returns a Chinese name when one exists in Google's own localization data —
 * most independent/local listings (esp. in Japan) have none and come back in
 * the local script, so this fills the gap with an LLM pass.
 *
 * Returns a map from original name to display name. Display-only: callers
 * keep using the original name for placeId/dedup matching. Never throws —
 * any failure (bad JSON, length mismatch, API error) falls back to mapping
 * every name to itself, so translation is a pure enhancement.
 */
export async function translatePlaceNames(
  names: string[],
  model: string,
): Promise<Map<string, string>> {
  const identity = new Map(names.map((n) => [n, n]));
  if (names.length === 0) return identity;

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `你是專業的旅遊翻譯。將以下地點名稱（飯店、餐廳、咖啡館等）完整翻譯成繁體中文，方便中文使用者閱讀。
Output strictly valid JSON: { "names": [string] }
The "names" array MUST have exactly ${names.length} items, in the SAME ORDER as the input list — one output per input, no additions or removals.
規則：
- 名稱中每一個日文假名（平假名／片假名）都必須轉換成中文或英文，絕對不可在輸出中保留任何假名字元。
- 常見詞彙請套用中文旅遊業慣用譯名，例如：駅→站、ホテル/ホテル＆リゾート→飯店/度假村、タワー→塔、アパ→APA、シティ→城市、イン→Inn。
- 日文漢字若與中文意義相同可直接保留（例如地名「淺草」「両国」請轉換成對應繁體字「淺草」「兩國」），片假名外來語一律轉成中文或英文，不可原樣保留。
- 國際知名連鎖品牌可保留其通用英文名稱（例如 Tobu Hotel Levant Tokyo）。
- 只輸出翻譯後的名稱本身，不要加註解、原文或引號以外的其他文字。`,
        },
        {
          role: "user",
          content: `Names in order: ${names.map((n) => `"${n}"`).join(", ")}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0].message.content;
    if (!content) return identity;

    const parsed = JSON.parse(content) as { names?: unknown[] };
    if (!Array.isArray(parsed.names) || parsed.names.length !== names.length) return identity;

    const result = new Map<string, string>();
    names.forEach((original, i) => {
      const translated = parsed.names?.[i];
      result.set(
        original,
        typeof translated === "string" && translated.trim() ? translated.trim() : original,
      );
    });
    return result;
  } catch {
    return identity;
  }
}

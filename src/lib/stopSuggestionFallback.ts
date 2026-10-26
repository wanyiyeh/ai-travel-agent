import { openai } from "@/lib/openai";
import { StopDescriptionFillSchema } from "@/lib/schemas";
import type { StopCandidate } from "@/types/itinerary";
import { UNTRUSTED_INPUT_RULE, wrapUntrusted } from "@/lib/untrustedInput";

// How many the model is asked for: enough that a few already on the day can
// be dropped afterwards and the picker still has a batch.
const SUGGESTION_COUNT = 10;

const normalize = (name: string) => name.toLowerCase().trim();

/**
 * The stop picker's last resort when Google has no candidates near the day:
 * the model suggests places of its own. The day's current names stay out of
 * the prompt, since they're Google's (ADR-0008); suggestions matching one
 * are dropped here instead.
 */
export async function suggestFallbackText(
  model: string,
  tripContext: string,
  dayTheme: string,
  excludeNames: string[],
): Promise<StopCandidate[]> {
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `你是專業的旅遊規劃專家。Always respond in Traditional Chinese (繁體中文).
Output strictly valid JSON matching this schema:
{ "candidates": [{ "name": string, "description": string, "duration_minutes": number }] }
Suggest ${SUGGESTION_COUNT} different attractions suitable for this day of the trip.${UNTRUSTED_INPUT_RULE}`,
      },
      {
        // tripContext can come from the request body, so it rides here as
        // tagged data rather than in the system prompt.
        role: "user",
        content: `Trip:\n${wrapUntrusted(tripContext)}\nDay theme: ${dayTheme}.\nSuggest ${SUGGESTION_COUNT} stops for this day.`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const aiContent = completion.choices[0].message.content;
  if (!aiContent) throw new Error("AI returned empty response");

  const parsedAI = StopDescriptionFillSchema.safeParse(JSON.parse(aiContent));
  if (!parsedAI.success) {
    throw new Error(`AI response validation failed: ${parsedAI.error.message}`);
  }

  const excluded = new Set(excludeNames.map(normalize));
  return parsedAI.data.candidates.filter((c) => !excluded.has(normalize(c.name)));
}

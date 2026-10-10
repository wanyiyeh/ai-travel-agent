import type { PreferenceIntent, TripPreferences } from "@/lib/schemas";

function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])];
}

/**
 * Combines the home form's explicit choices with what parsePreferenceIntent()
 * read out of the free-text blurb, into the one PreferenceIntent the
 * scheduler consumes (plan/form-preference-wiring.md 1a).
 *
 * - Single-choice fields (pace, start time): the form wins — the user picked
 *   it deliberately; free text only fills in when the form left it unset.
 * - List fields (interests, dietary restrictions): union of both sources.
 *   Form interest values double as interestBoost tags (culture/nature/
 *   shopping map to scheduler categories; others simply get no boost).
 * - avoid: free text only, the form has no such field.
 * - indoorFirst, selfDrive, kids: form only. 親子 also leads the interests
 *   with "kids", so a 親子同樂 day comes first in the theme rotation.
 */
export function mergePreferenceIntent(
  preferences: TripPreferences | undefined,
  parsed: PreferenceIntent
): PreferenceIntent {
  return {
    pace: preferences?.pace ?? parsed.pace,
    startTimePreference: preferences?.startTime ?? parsed.startTimePreference,
    interestBoost: union(
      [...(preferences?.companions?.includes("kids") ? ["kids"] : []), ...(preferences?.interests ?? [])],
      parsed.interestBoost
    ),
    dietaryRestrictions: union(preferences?.dietaryRestrictions ?? [], parsed.dietaryRestrictions),
    avoid: parsed.avoid,
    ...(preferences?.indoorFirst ? { indoorFirst: true } : {}),
    ...(preferences?.transport === "drive" ? { selfDrive: true } : {}),
    ...(preferences?.companions?.includes("kids") ? { kids: true } : {}),
  };
}

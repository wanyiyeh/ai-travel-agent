import { expect } from "vitest";

// ADR-0008: no Google Maps content may reach an OpenAI prompt. Tests name
// their fake Google places with googleName(), which carries a marker no real
// text contains, then check every captured prompt for it.

export const GOOGLE_CONTENT_MARKER = "GMAPS-CONTENT-MARKER";

/** A fake Google place name, recognisable wherever it ends up. */
export const googleName = (label: string) => `${label} ${GOOGLE_CONTENT_MARKER}`;

/** Fails when any of the inputs (prompt strings, message arrays, request bodies) carries a Google name. */
export function expectNoGoogleContent(...inputs: unknown[]) {
  for (const input of inputs) {
    const text = typeof input === "string" ? input : JSON.stringify(input);
    expect(text, "Google Maps content reached an LLM input (ADR-0008)").not.toContain(GOOGLE_CONTENT_MARKER);
  }
}

/** The `messages` of every call made to a mocked `openai.chat.completions.create`. */
export function capturedMessages(create: { mock: { calls: unknown[][] } }): unknown[] {
  return create.mock.calls.map((args) => (args[0] as { messages?: unknown }).messages);
}

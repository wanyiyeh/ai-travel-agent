import type { Mock } from "vitest";
import type { z } from "zod";
import { LlmOutputError, type LlmRequest } from "@/lib/llm";

// Unit tests replace generateObject (src/lib/llm.ts) with a vi.fn():
//
//   const generateObject = vi.fn();
//   vi.mock("@/lib/llm", async (importOriginal) => ({
//     ...(await importOriginal<typeof import("@/lib/llm")>()),
//     generateObject: (req: unknown) => generateObject(req),
//   }));
//
// and answer with replyWith(), which checks the reply against the call's
// schema the way llm.ts does, so an off-schema fixture fails like a real one.

type AnyRequest = LlmRequest<z.ZodType>;

/** A generateObject implementation answering `value`, checked against the request's schema. */
export function replyWith(value: unknown) {
  return async (req: AnyRequest) => {
    const result = req.schema.safeParse(value);
    if (!result.success) throw new LlmOutputError("invalid_output", result.error.message);
    return result.data;
  };
}

/** A generateObject implementation failing the way llm.ts does, e.g. on a refusal. */
export function failWith(reason: LlmOutputError["reason"]) {
  return async () => {
    throw new LlmOutputError(reason);
  };
}

/** The requests made to a mocked generateObject. */
export function llmRequests(generateObject: Mock): AnyRequest[] {
  return generateObject.mock.calls.map((args) => args[0] as AnyRequest);
}

/** The prompt text (system and user) of every request, for the ADR-0008 check. */
export function capturedPrompts(generateObject: Mock): string[] {
  return llmRequests(generateObject).flatMap((req) => [req.system, req.user]);
}

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { budgetExhaustedResponse } from "@/lib/dailyBudget";
import { consumeDailyBudget } from "@/lib/sharedState";
import { getMockMode, mockDelay } from "@/lib/mockAi";
import { recordOpenAICall } from "@/lib/usageMeter";

// Every Claude request in the app goes through this module (ADR-0012): one
// client whose fetch is the choke point for MOCK_AI, the site-wide daily
// call budget, and nothing else; usage is recorded from each response.

export const DEFAULT_LLM_MODEL = "claude-haiku-5-5";

// Haiku 5.5 thinks by default and its own default effort is "medium"; most
// calls here are short JSON lists, so they start lower and opt up.
export type LlmEffort = "low" | "medium" | "high";
export const DEFAULT_LLM_EFFORT: LlmEffort = "low";
export const DEFAULT_LLM_MAX_TOKENS = 16000;

/** The model to use: LLM_MODEL overrides the default (not ANTHROPIC_MODEL, which Claude Code itself reads). */
export function llmModel(): string {
  return process.env.LLM_MODEL || DEFAULT_LLM_MODEL;
}

export type LlmFailureReason = "refusal" | "max_tokens" | "invalid_output";

/**
 * A reply that can't be used. Haiku 5.5 has no server-side fallback for
 * refusals (ADR-0012), so a refusal fails the call like any other error.
 */
export class LlmOutputError extends Error {
  constructor(
    readonly reason: LlmFailureReason,
    detail?: string | null,
  ) {
    super(`LLM reply unusable (${reason})${detail ? `: ${detail}` : ""}`);
    this.name = "LlmOutputError";
  }
}

export interface LlmRequest<S extends z.ZodType> {
  system: string;
  user: string;
  /** The reply's shape: sent as the structured output format, then checked again here. */
  schema: S;
  effort?: LlmEffort;
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
  /** The reply under MOCK_AI; without one, a MOCK_AI call is refused like a real request. */
  mock?: () => unknown;
}

// A 400 with x-should-retry: false fails the request at once; the SDK would
// retry a 5xx.
function mockAiBlockedResponse(): Response {
  return new Response(
    JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: "MOCK_AI is set: a real Claude call was blocked (give it a mock reply)" },
    }),
    { status: 400, headers: { "Content-Type": "application/json", "x-should-retry": "false" } },
  );
}

async function guardedFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (getMockMode()) return mockAiBlockedResponse();
  if (!(await consumeDailyBudget("claude"))) return budgetExhaustedResponse("claude");
  return fetch(url, init);
}

let client: Anthropic | undefined;

// Built on first use, so code that only imports this module (or runs under
// MOCK_AI) needs no key.
function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !getMockMode()) throw new Error("Missing ANTHROPIC_API_KEY environment variable");
  client = new Anthropic({ apiKey: apiKey || "mock-ai-no-key", fetch: guardedFetch });
  return client;
}

// Only the JSON schema (unsupported constraints already stripped) is sent.
// The helper's own parser is left behind: the stream helper would run it on
// a refused or cut-off reply and throw before readReply() can say why.
function outputFormat(schema: z.ZodType): Anthropic.JSONOutputFormat {
  const { type, schema: jsonSchema } = zodOutputFormat(schema);
  return { type, schema: jsonSchema };
}

function requestParams<S extends z.ZodType>(req: LlmRequest<S>) {
  return {
    model: req.model ?? llmModel(),
    max_tokens: req.maxTokens ?? DEFAULT_LLM_MAX_TOKENS,
    system: req.system,
    messages: [{ role: "user" as const, content: req.user }],
    output_config: { effort: req.effort ?? DEFAULT_LLM_EFFORT, format: outputFormat(req.schema) },
  };
}

function recordUsage(usage: Anthropic.Usage | null): void {
  recordOpenAICall(
    usage && {
      prompt_tokens:
        usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
      completion_tokens: usage.output_tokens,
    },
  );
}

function validate<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new LlmOutputError("invalid_output", result.error.message);
  return result.data;
}

function readReply<S extends z.ZodType>(message: Anthropic.Message, schema: S): z.infer<S> {
  recordUsage(message.usage);
  if (message.stop_reason === "refusal") throw new LlmOutputError("refusal", message.stop_details?.category);
  if (message.stop_reason === "max_tokens") throw new LlmOutputError("max_tokens");
  const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LlmOutputError("invalid_output", "not JSON");
  }
  return validate(schema, json);
}

// Stands in for the request under MOCK_AI. Counted like a real call so a
// mock run still shows how many calls a real one makes (tokens stay 0).
async function mockReply<S extends z.ZodType>(req: LlmRequest<S>): Promise<z.infer<S> | undefined> {
  const mode = getMockMode();
  if (!mode || !req.mock) return undefined;
  recordUsage(null);
  if (mode === "slow") await mockDelay();
  if (mode === "error") throw new Error("Mock AI error (MOCK_AI=error)");
  return validate(req.schema, req.mock());
}

/** One request; resolves to the reply checked against `schema`. */
export async function generateObject<S extends z.ZodType>(req: LlmRequest<S>): Promise<z.infer<S>> {
  const mocked = await mockReply(req);
  if (mocked !== undefined) return mocked;
  const message = await getClient().messages.create(requestParams(req), { signal: req.signal });
  return readReply(message, req.schema);
}

/**
 * Streams one request: `onText` gets the reply's JSON text so far after each
 * piece arrives. Resolves to the reply checked against `schema`.
 */
export async function streamObject<S extends z.ZodType>(
  req: LlmRequest<S>,
  onText: (textSoFar: string) => void,
): Promise<z.infer<S>> {
  const mocked = await mockReply(req);
  if (mocked !== undefined) {
    onText(JSON.stringify(mocked));
    return mocked;
  }
  const stream = getClient().messages.stream(requestParams(req), { signal: req.signal });
  stream.on("text", (_delta, snapshot) => onText(snapshot));
  return readReply(await stream.finalMessage(), req.schema);
}

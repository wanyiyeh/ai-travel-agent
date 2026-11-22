import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { currentTally, runMetered } from "@/lib/usageMeter";

const consumeDailyBudget = vi.fn<(service: string) => Promise<boolean>>();
vi.mock("@/lib/sharedState", () => ({ consumeDailyBudget: (service: string) => consumeDailyBudget(service) }));

const { DEFAULT_LLM_MODEL, LlmOutputError, generateObject, streamObject } = await import("@/lib/llm");

const Reply = z.object({ cities: z.array(z.string()) });
const request = { system: "You list cities.", user: "Three cities in Japan", schema: Reply };

const fetchMock = vi.fn();

function message(text: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEFAULT_LLM_MODEL,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 120, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 5 },
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function sseResponse(pieces: string[], stopReason = "end_turn"): Response {
  const events: [string, unknown][] = [
    ["message_start", { type: "message_start", message: { ...message(""), content: [], stop_reason: null, usage: { input_tokens: 50, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ...pieces.map((text): [string, unknown] => [
      "content_block_delta",
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    ]),
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function sentBody(call = 0): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

beforeEach(() => {
  fetchMock.mockReset();
  consumeDailyBudget.mockReset();
  consumeDailyBudget.mockResolvedValue(true);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("generateObject", () => {
  it("returns the reply checked against the schema", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(message('{"cities":["Tokyo","Kyoto","Osaka"]}')));
    await expect(generateObject(request)).resolves.toEqual({ cities: ["Tokyo", "Kyoto", "Osaka"] });
  });

  it("sends Haiku 5.5 with structured output and effort, and no sampling parameters", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(message('{"cities":[]}')));
    await generateObject({ ...request, effort: "medium" });
    const body = sentBody();
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.system).toBe("You list cities.");
    expect(body.messages).toEqual([{ role: "user", content: "Three cities in Japan" }]);
    expect(body.output_config).toMatchObject({ effort: "medium", format: { type: "json_schema" } });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("thinking");
  });

  it("uses LLM_MODEL when set", async () => {
    vi.stubEnv("LLM_MODEL", "claude-sonnet-5-5");
    fetchMock.mockResolvedValueOnce(jsonResponse(message('{"cities":[]}')));
    await generateObject(request);
    expect(sentBody().model).toBe("claude-sonnet-5-5");
  });

  it.each([
    ["refusal", { stop_reason: "refusal", stop_details: { type: "refusal", category: "general_harms", explanation: null } }],
    ["max_tokens", { stop_reason: "max_tokens" }],
  ])("fails on a %s stop", async (reason, overrides) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(message('{"cities":["To', overrides)));
    await expect(generateObject(request)).rejects.toMatchObject({ name: "LlmOutputError", reason });
  });

  it("fails when the reply doesn't match the schema", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(message('{"cities":"Tokyo"}')));
    const error = await generateObject(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmOutputError);
    expect(error).toMatchObject({ reason: "invalid_output" });
  });

  it("records the call's tokens in the metered tally", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(message('{"cities":[]}')));
    const tally = await runMetered("test", async () => {
      await generateObject(request);
      return currentTally();
    });
    expect(tally?.openai).toEqual({ calls: 1, promptTokens: 125, completionTokens: 30 });
  });

  it("makes no request once the daily budget is spent", async () => {
    consumeDailyBudget.mockResolvedValue(false);
    await expect(generateObject(request)).rejects.toThrow();
    expect(consumeDailyBudget).toHaveBeenCalledWith("claude");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MOCK_AI", () => {
  it("returns the mock reply without a request", async () => {
    vi.stubEnv("MOCK_AI", "1");
    await expect(generateObject({ ...request, mock: () => ({ cities: ["Mock"] }) })).resolves.toEqual({ cities: ["Mock"] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a call that has no mock reply", async () => {
    vi.stubEnv("MOCK_AI", "1");
    await expect(generateObject(request)).rejects.toThrow(/MOCK_AI/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks the mock reply against the schema too", async () => {
    vi.stubEnv("MOCK_AI", "1");
    await expect(generateObject({ ...request, mock: () => ({ cities: "Mock" }) })).rejects.toMatchObject({ reason: "invalid_output" });
  });

  it("throws under MOCK_AI=error", async () => {
    vi.stubEnv("MOCK_AI", "error");
    await expect(generateObject({ ...request, mock: () => ({ cities: [] }) })).rejects.toThrow(/MOCK_AI=error/);
  });
});

describe("streamObject", () => {
  it("passes the text so far to onText and returns the checked reply", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['{"cities":', '["Tokyo"]}']));
    const seen: string[] = [];
    await expect(streamObject(request, (text) => seen.push(text))).resolves.toEqual({ cities: ["Tokyo"] });
    expect(seen).toEqual(['{"cities":', '{"cities":["Tokyo"]}']);
    expect(sentBody().stream).toBe(true);
  });

  it("fails on a refusal mid-stream", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['{"cit'], "refusal"));
    await expect(streamObject(request, () => {})).rejects.toMatchObject({ reason: "refusal" });
  });

  it("sends the mock reply as a single piece of text", async () => {
    vi.stubEnv("MOCK_AI", "1");
    const seen: string[] = [];
    await streamObject({ ...request, mock: () => ({ cities: ["Mock"] }) }, (text) => seen.push(text));
    expect(seen).toEqual(['{"cities":["Mock"]}']);
  });
});

describe("missing key", () => {
  it("fails with a clear error on the first real call", async () => {
    vi.resetModules();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fresh = await import("@/lib/llm");
    await expect(fresh.generateObject(request)).rejects.toThrow("Missing ANTHROPIC_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { useState, useCallback } from "react";
import type { Itinerary, Day } from "@/types/itinerary";
import type { FlightInfo, TripPreferences } from "@/lib/schemas";

type StreamingState = "idle" | "connecting" | "streaming" | "complete" | "error";

// Rule-engine path preview (plan/hybrid-rule-engine-scheduling.md Phase 5(c))
// — sent as a "plan" SSE event once planTrip() resolves, well before the
// itinerary itself is ready. Defined locally rather than imported from
// @/lib/assembleItineraryDays to keep this client hook decoupled from that
// server-only module.
export type TripPlanPreview = {
  title: string;
  currency: string;
  cities: Array<{ name: string; days: number }>;
};

export function useStreamingGenerate() {
  const [state, setState] = useState<StreamingState>("idle");
  const [partialData, setPartialData] = useState<string>("");
  const [plan, setPlan] = useState<TripPlanPreview | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [result, setResult] = useState<Itinerary | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number } | null>(null);

  const generate = useCallback(async (prompt: string, flightInfo: FlightInfo, preferences?: TripPreferences) => {
    setState("connecting");
    setPartialData("");
    setPlan(null);
    setDays([]);
    setResult(null);
    setId(null);
    setError("");
    setRetryInfo(null);

    try {
      const response = await fetch("/api/v1/generate-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, flightInfo, preferences }),
      });

      if (!response.ok) {
        throw new Error("Failed to connect to streaming API");
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      setState("streaming");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // 最後一行可能不完整，留在 buffer 等下一個 chunk
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.substring(6));

            if (data.type === "chunk") {
              setPartialData(data.content);
            } else if (data.type === "plan") {
              setPlan({ title: data.title, currency: data.currency, cities: data.cities });
            } else if (data.type === "day") {
              setDays((prev) => [...prev, data.day]);
            } else if (data.type === "retry") {
              // Server found an issue with the previous attempt and is
              // regenerating from scratch — clear stale partial content
              // (both the old chunk-based preview and the rule-engine
              // path's plan/day preview, whichever was in use) so nothing
              // shows a mix of two attempts.
              setPartialData("");
              setPlan(null);
              setDays([]);
              setRetryInfo({ attempt: data.attempt, maxAttempts: data.maxAttempts });
            } else if (data.type === "complete") {
              setResult(data.data);
              setId(data.id || null);
              setState("complete");
            } else if (data.type === "error") {
              setError(data.error + ": " + (data.details || ""));
              setState("error");
            }
          } catch {
            // 略過無法解析的行（不完整的 chunk 殘留）
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "發生未知錯誤");
      setState("error");
    }
  }, []);

  const reset = useCallback(() => {
    setState("idle");
    setPartialData("");
    setPlan(null);
    setDays([]);
    setResult(null);
    setId(null);
    setError("");
    setRetryInfo(null);
  }, []);

  return {
    state,
    partialData,
    plan,
    days,
    result,
    id,
    error,
    retryInfo,
    generate,
    reset,
    isLoading: state === "connecting" || state === "streaming",
  };
}

import { useState, useCallback } from "react";
import type { Itinerary } from "@/types/itinerary";
import type { FlightInfo, TripPreferences } from "@/lib/schemas";

type StreamingState = "idle" | "connecting" | "streaming" | "complete" | "error";

export function useStreamingGenerate() {
  const [state, setState] = useState<StreamingState>("idle");
  const [partialData, setPartialData] = useState<string>("");
  const [result, setResult] = useState<Itinerary | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const generate = useCallback(async (prompt: string, flightInfo: FlightInfo, preferences?: TripPreferences) => {
    setState("connecting");
    setPartialData("");
    setResult(null);
    setId(null);
    setError("");

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
    setResult(null);
    setId(null);
    setError("");
  }, []);

  return {
    state,
    partialData,
    result,
    id,
    error,
    generate,
    reset,
    isLoading: state === "connecting" || state === "streaming",
  };
}

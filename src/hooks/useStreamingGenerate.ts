import { useState, useCallback } from "react";
import type { Itinerary } from "@/types/itinerary";

type StreamingState = "idle" | "connecting" | "streaming" | "complete" | "error";

export function useStreamingGenerate() {
  const [state, setState] = useState<StreamingState>("idle");
  const [partialData, setPartialData] = useState<string>("");
  const [result, setResult] = useState<Itinerary | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const generate = useCallback(async (prompt: string, days: number) => {
    setState("connecting");
    setPartialData("");
    setResult(null);
    setId(null);
    setError("");

    try {
      const response = await fetch("/api/v1/generate-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, days }),
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

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
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

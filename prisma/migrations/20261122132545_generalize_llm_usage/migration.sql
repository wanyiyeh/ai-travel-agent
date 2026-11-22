-- The LLM moved from OpenAI to Claude (ADR-0012). Renamed rather than
-- dropped and re-added, so earlier measurements keep their counts; rows
-- before the switch are OpenAI's.
ALTER TABLE "UsageMeasurement" RENAME COLUMN "openai_calls" TO "llm_calls";
ALTER TABLE "UsageMeasurement" RENAME COLUMN "prompt_tokens" TO "llm_input_tokens";
ALTER TABLE "UsageMeasurement" RENAME COLUMN "completion_tokens" TO "llm_output_tokens";

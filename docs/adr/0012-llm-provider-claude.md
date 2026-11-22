# ADR-0012：LLM 從 OpenAI 換成 Claude API

日期：2026-11-22
狀態：Accepted

## 背景

目前所有 LLM 呼叫都用 OpenAI（`src/lib/openai.ts`，預設 `gpt-4o-mini`，以 `response_format: json_object` 要 JSON，舊流程用串流）。呼叫點包括偏好解析、城市順序與天數、移動日、季節亮點、經典一日遊、影劇取景、景點建議的文字備援、加景點、交通建議與重新規劃。

接下來要做行程聊天助理（[PLAN-004](../plans/PLAN-004-itinerary-chat.md)），需要可靠的工具呼叫與結構化輸出。使用者想統一改用 Claude API，並已建立 Claude Console 帳號與開發用 key（`ANTHROPIC_API_KEY`）。先換供應商、再做聊天助理，聊天助理就不必寫兩次。

## 決策

- 所有 LLM 呼叫改用官方 SDK `@anthropic-ai/sdk`，經過單一 client 模組，取代 `src/lib/openai.ts`；移除 `openai` 套件。
- JSON 輸出改用結構化輸出（`output_config.format`，以 Zod schema 驗證），取代 `response_format: json_object` 加事後解析。
- 模型：**Claude Haiku 5.5**（`claude-haiku-5-5`，使用者 2026-11-22 決定）。以環境變數切換，預設值寫成具名常數。
- Haiku 5.5 的限制與對應做法：
  - 思考預設開啟（adaptive），`effort` 預設 `medium`：每個呼叫點明確設定 `effort`，簡單的 JSON 擷取先試 `low`，以測試結果決定。不送 `budget_tokens`。
  - 不接受 `temperature`、`top_p`、`top_k` 的非預設值（400）：全部拿掉，輸出的穩定度改靠結構化輸出與提示。
  - 不接受 assistant prefill（400）。
  - **沒有伺服器端 fallback**：拒答（`stop_reason: "refusal"`）由程式檢查，當成這次呼叫失敗，走現有的失敗處理，不加 `fallbacks` 參數。
  - 思考區塊綁定前文：回送思考區塊時，它之前的內容若有任何改動會回 400。之後的聊天助理（PLAN-004）對話紀錄只存回覆文字，不存、也不回送思考區塊，因此可以只取最近幾則或更新系統指示，不受這項檢查限制。
- 其他模型的比較保留在下方，作為日後換模型的參考。
- `MOCK_AI`、`dev:free`、ADR-0008 守門測試、用量計量（`src/lib/usageMeter.ts`）、每日上限（`src/lib/dailyBudget.ts`）全部改接新的 client，行為不變：mock 模式不呼叫 API、不計費。

### 模型選項（Anthropic 官方價格，每百萬 token）

| 模型 | 輸入 | 輸出 | 說明 |
| --- | --- | --- | --- |
| Claude Opus 5.5 | $4.00 | $20.00 | 目前預設的旗艦模型，思考一律開啟，品質最好，也最慢 |
| Claude Sonnet 5.5 | $2.00 | $10.00 | 速度與能力平衡 |
| Claude Haiku 5.5 | $0.10 | $0.50 | **採用**。最快最便宜；提示超過 10 萬 token 時改為 $0.50／$2.50（本專案的提示遠低於此） |

對照：目前的 `gpt-4o-mini` 約為輸入 $0.15、輸出 $0.60（OpenAI 價格，以官網為準）。

## 考慮過的替代方案

- 維持 OpenAI，只有聊天助理用 Claude：兩套 SDK、兩套 mock、兩套計量與守門測試，維護成本加倍。
- 經由相容 OpenAI 格式的轉接層呼叫 Claude：拿不到結構化輸出、拒答處理等原生功能，且多一層不可控的依賴。
- 維持 OpenAI、聊天助理也用 OpenAI：不需要遷移，但不符合使用者想改用 Claude 的目標。

## 後果

- 每個呼叫點都要改寫並重跑對應測試；`MOCK_AI` 的假回應格式改成 Claude 的回應形狀。
- `UsageMeasurement` 的 `openaiCalls`、`promptTokens`、`completionTokens` 欄位要改名或泛化（schema 變更）；`usageMeter.ts` 的價格換成 Claude。
- 思考模式會產生額外的輸出 token，且 token 的計算方式與 OpenAI 不同，費用與生成時間要重新量測（會花錢，執行前先問，R1）。
- 選 Haiku 換來低成本與速度，代價是推理品質低於 Sonnet、Opus；若城市順序或天數分配的品質明顯變差，可只把那個呼叫點改用較大的模型（另寫 ADR）。
- `.env.example`、`README.md`、`docs/data-sources.md`、`/privacy` 的第三方服務、`CLAUDE.md` 的技術棧與 R1 描述都要改成 Anthropic。
- Vercel 正式環境要設定獨立的正式用 key，並確認 Console 餘額；切換前不開自動儲值。
- 換完確認正常後，才移除 `OPENAI_API_KEY`。

## 相關

[PLAN-004](../plans/PLAN-004-itinerary-chat.md)、[ADR-0008](0008-no-google-content-in-llm-input.md)、`src/lib/openai.ts`、`src/lib/usageMeter.ts`、`src/lib/mockAi.ts`

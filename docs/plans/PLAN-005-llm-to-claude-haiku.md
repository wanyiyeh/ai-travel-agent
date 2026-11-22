---
status: done             # draft | approved | in-progress | done
branch: plan-005-llm-to-claude-haiku
issue: 333               # 父 issue 編號，approved 後填寫
created: 2026-11-22
---

# PLAN-005：LLM 從 OpenAI 換成 Claude Haiku 5.5

## 目標

依 [ADR-0012](../adr/0012-llm-provider-claude.md)，把所有 LLM 呼叫從 OpenAI（`gpt-4o-mini`）換成 Claude Haiku 5.5，在 [PLAN-004](PLAN-004-itinerary-chat.md) 聊天助理之前完成，讓聊天助理直接寫在 Claude 上。使用者看到的行為不變。

## 非目標

- 改寫提示的內容或生成流程（只做換供應商必要的改動）
- 聊天助理本身（PLAN-004）
- 依呼叫點混用不同大小的模型（品質不夠時另寫 ADR）
- 調整 Google 相關的任何流程

## 驗收條件

- `src/` 與 `scripts/` 沒有 `openai` 套件的 import；`package.json` 移除 `openai`，加入 `@anthropic-ai/sdk`
- 所有呼叫經過單一 client 模組，模型預設 `claude-haiku-5-5` 寫成具名常數，可用環境變數覆寫
- 每個呼叫點用結構化輸出（Zod schema）取得 JSON，明確設定 `effort`，不送 `temperature`
- `stop_reason` 為 `refusal` 或 `max_tokens` 時當成呼叫失敗，走現有的失敗處理，不寫入半截結果
- 串流生成（`generate-stream`）前端看到的事件格式不變
- `MOCK_AI`、`dev:free` 完全不呼叫 Anthropic API；ADR-0008 守門測試涵蓋所有呼叫點
- 每日上限（`src/lib/dailyBudget.ts`）與用量計量（`src/lib/usageMeter.ts`）改算 Claude 的 token 與價格；`UsageMeasurement` 欄位改成不綁供應商的名稱（含 migration）
- `npm run lint`、`npx tsc --noEmit`、`npm test`、`npm run test:integration`、`npm run build` 通過
- 用真實 API 生成一份行程，畫面與目前一致，並量出一次生成的 Claude 費用與時間寫進 runbook
- `.env.example`、`README.md`、`docs/data-sources.md`、`/privacy`、`CLAUDE.md`（技術棧、R1）改成 Anthropic

## 邊界情況

- Claude 拒答（安全分類器誤判，例如城市名稱觸發）：Haiku 5.5 沒有伺服器端 fallback，視同失敗並顯示既有錯誤訊息，不重試同一提示
- 回應被 `max_tokens` 截斷：結構化輸出不完整，當成失敗
- 429 / 5xx：沿用 SDK 內建重試（預設 2 次），用完後走既有失敗處理
- 串流途中斷線：沿用 `generateStreamDisconnect` 的處理，測試照舊通過
- 缺 `ANTHROPIC_API_KEY`：啟動或第一次呼叫時給明確錯誤，不靜默改用 mock
- Zod schema 用到結構化輸出不支援的寫法：在單元測試就要失敗，不等到真實呼叫

## 成本

- 開發與測試全程用 `MOCK_AI` 與 `dev:free`，免費。
- 最後驗收：`npm run dev:mock`（Google 假資料）用真實 Claude 生成 2～3 份行程，加上加景點、交通建議、重新規劃各 1 次。以 Haiku 5.5 的價格估計遠低於 US$0.10。跑之前先問（R1）。
- Vercel 正式環境切換時另外確認 Console 餘額與正式用 key。

## 設計摘要

- 新增 `src/lib/llm.ts`（取代 `src/lib/openai.ts`）：建立 Anthropic client、模型常數、`effort` 預設、拒答與截斷檢查、每日上限與計量；對外提供「給 system、user 與 Zod schema，回傳驗證過的物件」與串流版兩個函式。各呼叫點只換成呼叫這兩個函式。
- 結構化輸出用 SDK 的 `messages.parse` 搭配 Zod；串流用 `messages.stream`，`finalMessage()` 取完整結果，前端事件格式由 route 轉換，維持不變。
- `effort`：預設 `low`，城市順序與天數分配先試 `medium`；最後以真實生成比對品質決定，數值只寫在程式碼。
- `mockAi.ts` 的假回應改成直接回傳符合 schema 的物件，不再模擬 OpenAI 的回應形狀。
- 取捨見 [ADR-0012](../adr/0012-llm-provider-claude.md)。

## 任務拆解

1. (#334) 加入 `@anthropic-ai/sdk`，建立 `src/lib/llm.ts`（client、常數、拒答／截斷檢查、上限與計量），含單元測試
2. (#335) `mockAi.ts` 與 ADR-0008 守門測試改接新模組
3. (#336) 改寫非串流呼叫點：偏好解析、季節亮點、經典一日遊、影劇取景、城市天數、景點建議備援、加景點、交通建議
4. (#337) 改寫串流生成（`generate-stream`）與重新規劃
5. (#338) `UsageMeasurement` 欄位泛化（schema migration）與 `usageMeter.ts` 價格
6. (#339) 移除 `openai` 套件與 `src/lib/openai.ts`；更新 `.env.example`、`README.md`、`data-sources.md`、`/privacy`、`CLAUDE.md`
7. (#340) 真實 API 驗收與量測（先問），結果寫進 runbook

## 完成後遷移清單

- [ ] ADR-0012 的「後果」補上實際量測結果的連結
- [ ] runbook：Claude 費用量測與每日上限
- [ ] data-sources.md：Anthropic
- [ ] glossary：如有新詞

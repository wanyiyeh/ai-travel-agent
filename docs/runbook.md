# Runbook

維運步驟：成本量測、部署、排程、成本排查。部署相關的步驟在 PLAN-001 部署階段（#213）補上。

## 量測一次生成的花費

每次 `generate-stream` 的呼叫次數會寫進 `UsageMeasurement` 表（`src/lib/usageMeter.ts`），同時印出 `[usage]` log。Google 依「端點 + 欄位」分開計數，因為欄位決定計費等級。

**量測快取全部沒命中的情況**（不花 Google 的錢；OpenAI 是真的，先依 `CLAUDE.md` R1 詢問）：

1. 用一個全新的資料庫，避免讀到舊快取：`MOCK_PLACES=1 DATABASE_URL="file:./mock.db.measure" npx prisma db push --skip-generate`
2. 用同樣的環境變數啟動 `npx next dev -p 3005`，加上 `TURNSTILE_SECRET_KEY=""`（開發環境略過人機驗證，讓 curl 可以直接呼叫）。
3. `curl -N -X POST http://localhost:3005/api/v1/generate-stream`，body 帶 `flightInfo`；每次用不同的 `x-forwarded-for`，避免碰到訪客額度。
4. 讀 `UsageMeasurement` 表或伺服器的 `[usage]` log。

Route Matrix 每次請求都是 1 個起點 × 1 個終點（`src/lib/distanceMatrix.ts`），所以請求數等於計費的元素數。

## 量測結果

快取全部沒命中，`MOCK_PLACES` 下計數；價格依 [Google 價目表](https://developers.google.com/maps/billing-and-pricing/pricing)（2026-10-16 版，超過免費額度後的第一級單價）。

| 日期 | 行程 | Text Search Pro | Nearby Pro | Nearby Enterprise | Route Matrix | Google 估算 | OpenAI 呼叫 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-20 | 東京來回 5 天 | 9 | 5 | 1 | 8 | US$0.52 | 10 |
| 2026-10-20 | 首爾進、釜山出 6 天 | 11 | 10 | 2 | 10 | US$0.79 | 13 |

OpenAI（`gpt-4o-mini`）每次生成約 US$0.003～0.004。

## 換算每日配額

GCP 的每日配額以請求次數設定，分不出當天用的是不是免費額度。要讓「最壞情況每天不超過上限」，就要假設每次都照價收費：

每個 SKU 的每日配額 ≈ 每日上限金額 × 該 SKU 佔一次生成費用的比例 ÷ 該 SKU 的單價

以每日 US$3、一次生成約 US$0.8 計算，只夠約 4 次生成，低於 app 的全站每日生成上限（`src/lib/quota.ts`）。兩者要一起調整，在 #213 決定。

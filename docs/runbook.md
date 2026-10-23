# Runbook

維運步驟：成本量測、部署、排程、成本排查。部署相關的步驟在 PLAN-001 部署階段（#213）補上。

## 量測一次生成的花費

每次 `generate-stream` 的呼叫次數會寫進 `UsageMeasurement` 表（`src/lib/usageMeter.ts`），同時印出 `[usage]` log。Google 依「端點 + 欄位」分開計數，因為欄位決定計費等級。

**完全免費的量測**（Google 與 OpenAI 都是假資料）：

1. 用一個全新的資料庫，避免讀到舊的 `PlaceQuery`：`MOCK_PLACES=1 DATABASE_URL="file:./mock.db.measure-YYYYMMDD" npx prisma db push --skip-generate`（檔名要以 `mock.db` 開頭，才會被 `.gitignore` 排除）。
2. 用同樣的資料庫啟動 `npx next dev -p 3005`，加上 `MOCK_PLACES=1 MOCK_AI=1 COMPLIANT_PLACE_STORAGE=1 TURNSTILE_SECRET_KEY=""`（開發環境略過人機驗證，讓 curl 可以直接呼叫）。同一個資料夾只能有一個 dev server，先停掉其他的。
3. `curl -N -X POST http://localhost:3005/api/v1/generate-stream`，body 帶 `flightInfo`；每次用不同的 `x-forwarded-for`，避免碰到訪客額度。
4. 讀 `UsageMeasurement` 表或伺服器的 `[usage]` log。

`MOCK_AI` 的假回應不會寫出真的景點名稱，所以依 LLM 寫的名稱去找地點的 Text Search 會少算。要算準這一項，拿掉 `MOCK_AI=1`，改用真的 OpenAI（先依 `CLAUDE.md` R1 詢問，一次生成約 US$0.003）。

Route Matrix 每次請求都是 1 個起點 × 1 個終點（`src/lib/distanceMatrix.ts`），所以請求數等於計費的元素數。

## 量測結果

全新資料庫、`MOCK_PLACES` 下計數。價格依 [Google 價目表](https://developers.google.com/maps/billing-and-pricing/pricing)（2026-10-16 版），取超過免費額度後的第一級單價。

| 日期 | 行程 | OpenAI | Text Search Pro | Text Search IDs Only | Place Details Essentials | Nearby Pro | Nearby Enterprise | Route Matrix | Google 估算 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-20 | 東京來回 5 天 | 真的 | 9 | 0 | 0 | 5 | 1 | 8 | US$0.52 |
| 2026-10-20 | 首爾進、釜山出 6 天 | 真的 | 11 | 0 | 0 | 10 | 2 | 10 | US$0.79 |
| 2026-10-23 | 東京來回 5 天 | 假的 | 0 | 0 | 0 | 5 | 1 | 9 | US$0.24 |
| 2026-10-23 | 首爾進、釜山出 6 天 | 假的 | 0 | 2 | 2 | 9 | 2 | 9 | US$0.41 |

- 2026-10-20 是改用 IDs Only 找地點（#203）之前的數字；2026-10-23 是 #203 之後的數字，用的是假的 OpenAI，Text Search 會少算（見上一節）。
- 2026-10-20 的數字是「快取全部沒命中」的情況；#203 之後候選池與路線不再跨請求保存，每次生成都接近這個數字，同城市重複生成也一樣。
- 現在最貴的是 Nearby Search Pro。

OpenAI（`gpt-4o-mini`）每次生成約 US$0.003～0.004。

## 刪除過期座標

Google 的座標最多保存 30 天（[ADR-0006](adr/0006-coordinate-expiry.md)）。`npm run purge-expired-coords` 從行程、候選紀錄、垃圾桶與 `Place` 表刪掉過期或沒有取得時間的座標，不呼叫任何 API。上線後每天執行（#211）；之前手動：

- `COMPLIANT_PLACE_STORAGE=1 npm run purge-expired-coords`（`dev.db`）
- `COMPLIANT_PLACE_STORAGE=1 DATABASE_URL="file:./mock.db" npm run purge-expired-coords`（`mock.db`）

沒有設定 `COMPLIANT_PLACE_STORAGE=1` 時什麼都不做：那時寫入不記錄取得時間，所有座標都會被當成過期。第一次在舊資料庫執行，會刪掉開關啟用前留下的全部座標；打開那一天時會重新取得。

## 換算每日配額

GCP 的每日配額以請求次數設定，分不出當天用的是不是免費額度。要讓「最壞情況每天不超過上限」，就要假設每次都照價收費：

每個 SKU 的每日配額 ≈ 每日上限金額 × 該 SKU 佔一次生成費用的比例 ÷ 該 SKU 的單價

以每日 US$3、一次生成約 US$0.4 計算，只夠約 7 次生成，低於 app 的全站每日生成上限（`src/lib/quota.ts`）。兩者要一起調整，在 #213 決定。

# Runbook

維運步驟：成本量測、部署、排程、成本排查。部署相關的步驟在 PLAN-001 部署階段（#213）補上。

## 量測一次生成的花費

每次 `generate-stream` 的呼叫次數會寫進 `UsageMeasurement` 表（`src/lib/usageMeter.ts`），同時印出 `[usage]` log。Google 依「端點 + 欄位」分開計數，因為欄位決定計費等級。

**完全免費的量測**（Google 與 OpenAI 都是假資料）：

1. 用一個全新的資料庫，避免讀到舊的 `PlaceQuery`：`docker compose exec db createdb -U travel travel_mock_measure`，再 `DATABASE_URL="postgresql://travel:travel@localhost:5432/travel_mock_measure" npx prisma migrate deploy`（名稱要含 `mock`，`MOCK_PLACES` 才肯用）。
2. 用同樣的資料庫啟動 `npx next dev -p 3005`，加上 `MOCK_PLACES=1 MOCK_AI=1 TURNSTILE_SECRET_KEY=""`（開發環境略過人機驗證，讓 curl 可以直接呼叫）。同一個資料夾只能有一個 dev server，先停掉其他的。
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

- `npm run purge-expired-coords`（開發資料庫）
- `DATABASE_URL="postgresql://travel:travel@localhost:5432/travel_mock" npm run purge-expired-coords`（`travel_mock`）

沒有取得時間的座標視為過期：第一次在舊資料庫執行，會刪掉 #204 以前留下的座標；打開那一天時會重新取得。

## 稽核與清理 Google 內容

寫入時一律移除 Google 欄位（`src/lib/placeStorage.ts`），但在那之前存下的資料可能還有名稱、地址、評分、照片、沒有時間的座標（`src/lib/googleContentAudit.ts`）。`Place` 表的舊欄位與四張內容快取表已從資料庫結構移除（#206）。

1. 稽核：`npm run audit-google-content`。印出每個資料表的違規筆數，`total` 為 0 才算合規；有違規時以狀態碼 1 結束。
2. 備份：先匯出資料庫，例如 `docker compose exec -T db pg_dump -U travel travel > prisma/backup-YYYYMMDD.sql`。清理不可逆。
3. 預覽：`npm run cleanup-google-content` 只列出會移除什麼。
4. 清理：`npm run cleanup-google-content -- --yes`。結束後會再稽核一次。可以重複執行。

對 `travel_mock` 加上 `DATABASE_URL="postgresql://travel:travel@localhost:5432/travel_mock"`。不呼叫任何 API。

## 從 SQLite 搬資料到 Postgres

改用 Postgres（ADR-0007）之前的資料在 `prisma/dev.db`、`prisma/mock.db`。`npm run copy-sqlite-to-postgres` 依目前的資料表結構逐表搬到 `DATABASE_URL`，先搬被參照的表；結構裡已經沒有的表與欄位（#206）不搬。SQLite 檔只讀不改；Postgres 裡已有同一筆（主鍵相同）就保留，可以重複執行。不呼叫任何 API。

1. 先 `npm run db:up`，並確認目標資料庫已套用 migration（`npx prisma migrate deploy`）。
2. 預覽：`npm run copy-sqlite-to-postgres -- prisma/dev.db`，列出每個表的筆數。
3. 搬：`npm run copy-sqlite-to-postgres -- prisma/dev.db --yes`。
4. 模擬資料：`DATABASE_URL="postgresql://travel:travel@localhost:5432/travel_mock" npm run copy-sqlite-to-postgres -- prisma/mock.db --yes`。
5. 搬完用 `npm run audit-google-content` 確認為 0。

## 換算每日配額

GCP 的每日配額以請求次數設定，分不出當天用的是不是免費額度。要讓「最壞情況每天不超過上限」，就要假設每次都照價收費：

每個 SKU 的每日配額 ≈ 每日上限金額 × 該 SKU 佔一次生成費用的比例 ÷ 該 SKU 的單價

以每日 US$3、一次生成約 US$0.4 計算，只夠約 7 次生成，低於 app 的全站每日生成上限（`src/lib/quota.ts`）。兩者要一起調整，在 #213 決定。

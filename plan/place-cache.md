# Place Cache 設計說明

> 建立日期：2026-07-02

---

## 動機

每次使用者對行程景點執行 enrich（查 Google Places API），都會消耗一次 API 配額。同一個地點（例如「淺草寺 東京」）可能出現在：

- 不同使用者的行程
- 同一行程重新 enrich（例如 regenerate 後）
- 種子資料與使用者行程重疊

目標：**同一個地點只打一次 Google API，後續全部從 DB 讀取。**

---

## 資料庫 Schema

```prisma
model Place {
  id        String       @id     // Google Place ID（格式：ChIJ...）
  name      String               // 地點名稱（來自 displayName.text）
  address   String?              // 格式化地址
  lat       Float?               // 緯度
  lng       Float?               // 經度
  rating    Float?               // Google 評分
  updatedAt DateTime     @updatedAt
  queries   PlaceQuery[]
}

model PlaceQuery {
  query    String   @id          // 搜尋字串（例如「淺草寺 東京」）
  placeId  String                // 對應的 Google Place ID
  place    Place    @relation(fields: [placeId], references: [id])
  cachedAt DateTime @default(now())
}
```

兩張表分開的原因：
- `Place` 以 Google Place ID 為主鍵 — 一個真實地點只有一筆
- `PlaceQuery` 以搜尋字串為主鍵 — 同一個地點可能用不同 query 搜尋到

---

## 快取工具：`src/lib/placeCache.ts`

提供三個函式供各 API route 使用：

| 函式 | 用途 |
|---|---|
| `lookupByQuery(query)` | 用搜尋字串查快取，回傳地點資料或 null |
| `lookupByPlaceId(placeId)` | 用 Place ID 查快取，回傳地點資料或 null |
| `upsertPlace(query, data)` | 將 Google API 結果同時寫入 Place + PlaceQuery |

---

## Enrich 流程

### Stop Enrich（`/api/v1/stops/[stopId]/enrich`）

```
stop 已有 placeId + lat + lng？
  └─ YES → 直接回傳（不打 DB，不打 API）

query = stop.name + waypointCity

PlaceQuery[query] 有快取？
  └─ YES → 從 Place 表讀取 → 更新 stop JSON → 回傳

stop 已有 placeId（但快取沒有）？
  └─ YES → Place[placeId] 有快取？
            └─ YES → 從 Place 表讀取 → 更新 stop JSON → 回傳
            └─ NO  → 呼叫 Google API ↓

呼叫 Google Places searchText API
  └─ 找到 → upsertPlace(query, result) → 更新 stop JSON → 回傳
  └─ 找不到 → 回傳 404
```

### Accommodation Enrich（`/api/v1/days/[dayId]/accommodation/enrich`）

```
accommodation 已有 placeId？
  └─ YES → 直接回傳（既有邏輯，不重複 enrich）

query = accName + area + cityHint

PlaceQuery[query] 有快取？
  └─ YES → 從快取組裝結果 → 產生 bookingUrl → 回傳

呼叫 Google Places searchText API
  └─ 找到 → upsertPlace(query, result) → 產生 bookingUrl → 回傳
  └─ 找不到 → 回傳 404
```

---

## Batch Enrich：`/api/v1/itinerary/[id]/enrich-all-stops`

一次處理整份行程所有 stop，避免 N 次 HTTP round trip。

流程與單筆 stop enrich 相同，但：
- 在伺服器端迴圈所有 day × stop
- 最後**一次** `prisma.itinerary.update` 寫入整份行程
- 回傳統計：`{ enriched, cached, skipped, failed }`

UI 入口：行程頁面 sticky nav bar 的「儲存所有地點」按鈕。

---

## 種子資料回填：`scripts/backfill-place-cache.ts`

種子資料在 seed 時已透過 Google API enrich，stop JSON 裡已有 `placeId`、`lat`、`lng`，但當時沒有寫進快取表。

回填 script 做的事：
1. 讀出所有行程的 JSON blob
2. 每個有 `placeId` + 座標的 stop → upsert 到 `Place` + `PlaceQuery`
3. **0 次 Google API 呼叫**

```bash
npm run backfill-places
```

新種子資料（`npm run seed`）則會在 enrich 的同時直接寫入快取，不需要另外回填。

---

## API 呼叫節省效果

| 情況 | 呼叫次數 |
|---|---|
| 同一 stop 重複 enrich | 0（早回傳） |
| 同 query 出現在不同行程 | 0（PlaceQuery 快取） |
| 同地點不同 query | 0（Place 快取） |
| 全新地點，首次 enrich | 1 |

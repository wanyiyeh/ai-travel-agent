# API 資料夾結構與功用說明

> 所有 API 位於 `src/app/api/v1/`，以下依路由分組說明各檔案功用及其依賴的 `src/lib/` 檔案。

---

## `generate-stream`

### `POST /api/v1/generate-stream`

接收航班資訊和旅遊偏好，透過 OpenAI streaming 即時產出完整旅程 JSON，驗證後存入資料庫，以 SSE (text/event-stream) 格式回傳。

| lib 檔案 | 用途 |
|---|---|
| `lib/openai.ts` | OpenAI client，呼叫 streaming completion |
| `lib/schemas.ts` | `ItinerarySchema`、`FlightInfoSchema`、`TripPreferencesSchema` 驗證輸入與 AI 輸出 |
| `lib/validateItinerary.ts` | 邏輯驗證（天數對齊、移動日正確性等） |
| `lib/iataCity.ts` | IATA 機場代碼轉城市名稱中文 |
| `lib/fetchCityRestaurants.ts` | 取得城市餐廳資料，注入 system prompt 提升餐廳推薦品質 |
| `lib/db.ts` | `prisma` 存行程、`j()` 序列化 JSON |

---

## `itinerary/[id]`

### `GET /api/v1/itinerary/[id]`

讀取單一行程，從 config 或 flightInfo 推斷貨幣代碼後一併回傳。

### `DELETE /api/v1/itinerary/[id]`

刪除指定行程。

| lib 檔案 | 用途 |
|---|---|
| `lib/db.ts` | `prisma` 查詢 / 刪除資料庫 |

---

## `itinerary/[id]/batch-insert-waypoints`

### `POST /api/v1/itinerary/[id]/batch-insert-waypoints`

批次插入多個中途城市，自動生成各城市的移動日景點、停留天景點、住宿、三餐，並用 AI 找最佳插入位置。插入時會快照原始後段行程（`_originalAfter`）供日後 remove-waypoint 還原用。

| lib 檔案 | 用途 |
|---|---|
| `lib/db.ts` | 讀取行程、更新 days |
| `lib/schemas.ts` | `TransitRecommendationSchema` 驗證請求中的城市資料 |
| `lib/openai.ts` | 生成移動日景點、住宿餐廳、最佳插入位置判斷 |
| `lib/iataCity.ts` | 從 flightInfo 取得出發 / 返回城市名稱 |

---

## `itinerary/[id]/remove-waypoint`

### `DELETE /api/v1/itinerary/[id]/remove-waypoint`

移除行程中的某個中途城市（含移動日和停留天）。優先使用插入時快照的 `_originalAfter` 完整還原後段行程；若無快照則回退到局部修復模式。

| lib 檔案 | 用途 |
|---|---|
| `lib/db.ts` | 讀取行程、更新 days |

---

## `itinerary/[id]/transit-recommendations`

### `POST /api/v1/itinerary/[id]/transit-recommendations`

根據起點 / 終點 IATA 代碼，用 AI 推薦中途可順遊的城市或國家（3–5 個）。單城市行程推薦周邊城市；多城市行程推薦兩機場之間的過境目的地。支援 mock 模式。

| lib 檔案 | 用途 |
|---|---|
| `lib/openai.ts` | 呼叫 AI 取得推薦清單 |
| `lib/schemas.ts` | `TransitRecommendationSchema` 驗證並過濾 AI 回傳 |
| `lib/mockAi.ts` | `getMockMode()`、`MOCK_FIXTURES` 供開發測試用 |

---

## `stops/[stopId]`

### `PATCH /api/v1/stops/[stopId]`

編輯景點的 `name`、`description`、`duration_minutes`。

### `DELETE /api/v1/stops/[stopId]`

從行程中刪除指定景點。

| lib 檔案 | 用途 |
|---|---|
| `lib/db.ts` | 讀取行程、更新 days |

---

## `stops/[stopId]/enrich`

### `POST /api/v1/stops/[stopId]/enrich`

呼叫 Google Places API，將景點的經緯度、地址、評分、開放時間填進資料。若找不到則回傳 404。

| lib 檔案 | 用途 |
|---|---|
| `lib/db.ts` | 讀取行程、寫回 enrich 後的 stop |

> 直接呼叫 Google Places API，不透過 lib 封裝。

---

## `stops/[stopId]/regenerate`

### `POST /api/v1/stops/[stopId]/regenerate`

用 AI 為指定景點產生一個替代景點（排除行程中已有的所有景點名稱），並替換進行程，同時清除舊的地理資料（lat / lng / address / placeId）。支援 mock 模式。

| lib 檔案 | 用途 |
|---|---|
| `lib/db.ts` | 讀取行程、寫回新 stop |
| `lib/openai.ts` | 呼叫 AI 生成替代景點 |
| `lib/schemas.ts` | `StopSchema` 驗證 AI 回傳格式 |
| `lib/mockAi.ts` | mock 模式支援 |

---

## `stops/reorder`

### `POST /api/v1/stops/reorder`

根據前端傳入的新 `stopIds` 順序，更新指定天所有景點的 `orderIndex`。

| lib 檔案 | 用途 |
|---|---|
| `lib/db.ts` | 讀取行程、寫回重排後的 stops |

---

## `days/[dayId]/stops`

### `POST /api/v1/days/[dayId]/stops`

新增景點到指定天，由 AI 自動補齊描述、停留分鐘、費用估算、時段（morning / afternoon / evening）、交通說明。

| lib 檔案 | 用途 |
|---|---|
| `lib/db.ts` | 讀取行程、append 新 stop |
| `lib/openai.ts` | 呼叫 AI 生成 stop 詳細資料 |

---

## `days/[dayId]/recalculate-transport`

### `POST /api/v1/days/[dayId]/recalculate-transport`

景點被重新排序後，用 AI 重算每個景點的交通方式和時段。先以 Google Distance Matrix 取得相鄰景點間的真實距離和開車時間，注入 prompt 讓 AI 給出更準確的交通描述。

| lib 檔案 | 用途 |
|---|---|
| `lib/db.ts` | 讀取行程、寫回更新後的 `transport_from_prev` 和 `time_of_day` |
| `lib/openai.ts` | 讓 AI 根據景點距離推算交通方式與時段 |
| `lib/distanceMatrix.ts` | 取得相鄰景點間的真實距離和開車時間，注入 prompt |

---

## `days/[dayId]/accommodation/enrich`

### `POST /api/v1/days/[dayId]/accommodation/enrich`

透過 Google Places API 查詢住宿的經緯度、地址、評分、價位（PRICE_LEVEL），並依 flightInfo 的出發日期與天數自動產生 Booking.com 預訂連結（含入住 / 退房日期和人數）。若已有 `placeId` 則直接回傳。

| lib 檔案 | 用途 |
|---|---|
| `lib/db.ts` | 讀取行程、寫回 enrich 後的 accommodation |

> 直接呼叫 Google Places API，不透過 lib 封裝。

---

## `days/[dayId]/accommodation/regenerate`

### `POST /api/v1/days/[dayId]/accommodation/regenerate`

用 AI 根據當天景點位置推薦最合適的住宿（避免與現有住宿重複），並替換進行程。支援 mock 模式。

| lib 檔案 | 用途 |
|---|---|
| `lib/db.ts` | 讀取行程、寫回新 accommodation |
| `lib/openai.ts` | 呼叫 AI 推薦住宿 |
| `lib/schemas.ts` | `AccommodationSchema` 驗證 AI 回傳 |
| `lib/mockAi.ts` | mock 模式支援 |

---

## lib 檔案被使用頻率總覽

| lib 檔案 | 說明 | 被使用的 API 數量 |
|---|---|---|
| `lib/db.ts` | Prisma client 與 JSON 序列化工具 | 13（全部） |
| `lib/openai.ts` | OpenAI client 封裝 | 8 |
| `lib/schemas.ts` | Zod schema 定義（行程、航班、景點等） | 5 |
| `lib/mockAi.ts` | 開發用 mock 模式控制與 fixture 資料 | 3 |
| `lib/iataCity.ts` | IATA 代碼轉中文城市名稱 | 2 |
| `lib/distanceMatrix.ts` | Google Distance Matrix API 封裝 | 1 |
| `lib/validateItinerary.ts` | 行程邏輯驗證（天數、移動日等） | 1 |
| `lib/fetchCityRestaurants.ts` | 透過 Google Places 取得城市餐廳清單 | 1 |

# src/lib 目錄分析筆記

> 最後更新：2026-07-04

`src/lib` 是專案的核心邏輯層：AI prompt 組裝、行程驗證、Google Places 整合、資料庫存取都集中在這裡。API routes（`src/app/api/v1/**`）是薄層，實際邏輯多半呼叫這裡的函式。

## 檔案總覽

| 檔案 | 用途 |
|---|---|
| `itineraryGen.ts` | 組出給 OpenAI 的 system prompt；行程資料修復（移動日、waypointCity） |
| `validateItinerary.ts` | 驗證 AI 生成的行程結構是否合理，回傳 issue 清單 |
| `validateGeography.ts` | 驗證同一天景點之間的直線距離是否過遠（⚠️ 目前未被任何地方引用） |
| `distanceMatrix.ts` | Haversine 直線距離計算 + Google Distance Matrix API 封裝 |
| `fetchCityRestaurants.ts` | 用 Google Places Nearby Search 取得城市餐廳/景點清單，注入 prompt |
| `placeCache.ts` | Place / PlaceQuery 資料表的查詢與寫入封裝（座標快取層） |
| `iataCity.ts` | IATA 機場代號 → 中文城市名稱對照表 |
| `schemas.ts` | Zod schema 定義（FlightInfo、Itinerary、Day、Stop 等） |
| `db.ts` | Prisma Client 單例，含 SQLite JSON 欄位自動序列化擴充 |
| `openai.ts` | OpenAI SDK client 單例 |
| `mockAi.ts` | `MOCK_AI` 環境變數控制的假資料，供 UI 測試不打真實 API |

---

## 1. `itineraryGen.ts` — Prompt 組裝與行程修復

### 用途
這是整個 AI 生成流程的「大腦」：組出給 OpenAI 的完整 system prompt，並提供幾個修復函式，在 AI 回傳結果不完全符合規則時做事後修正。

### 主要匯出

| 函式/常數 | 功能 |
|---|---|
| `paceMap` / `budgetMap` / `interestMap` | 使用者偏好的中文對照表（如 `pace: "moderate"` → `"適中，每天安排 3-4 個景點"`） |
| `calcDays(departureDate, returnDate)` | 計算總天數 |
| `buildFlightTimePrompt(flightInfo)` | 組出航班抵達/出發時間限制的 prompt 片段 |
| `buildPreferencePrompt(preferences)` | 組出使用者偏好的 prompt 片段 |
| `buildSystemPrompt(flightInfo, preferences, days, restaurantHintsPrompt)` | **核心函式**：組出完整 system prompt，含 JSON 結構範本與 19 條規則 |
| `tagWaypointCities(days, startCity)` | 幫每天標記所在城市；優先信任 AI 自己填的 `waypointCity`，缺漏時才用 `isTransitDay`/`transitTo` 鏈推回上一個城市 |
| `repairTransitDayDepartureCities(days)` | 修正移動日 stop 名稱裡的出發城市（若 AI 誤寫，用該天自己的 `waypointCity` 取代） |

### `buildSystemPrompt` 的規則設計重點
- **多城市 vs 單城市**：`arrivalCity !== returnDepartureCity` 時才加入跨城市移動指示。
- **多段移動（漸進路線）**：支援「沿海岸公路/鐵路逐站前進」的行程可以有不只一個 `isTransitDay: true`，每次真正換城鎮過夜才標記一次，最後一個移動日的 `transitTo` 必須等於 `returnDepartureCity`。這是為了讓 NY→DC→Savannah→Miami 這類多段路線能誠實反映每天所在城鎮，而不是把中途城鎮硬塞進 `arrivalCity` 或 `returnCity` 兩個角色裡。
- **回程日規則**：第 N 天（回程日）絕對不可以是移動日，這點在 prompt 裡强調了兩次（多城市段落 + JSON 範本註解），因為早期版本的行程曾出現「回程日被誤標成移動日、`transitTo` 填成『台灣』」的錯誤（詳見規則 7）。
- **景點名稱規則（規則 16-17）**：禁止用描述性泛稱代替真實地點名稱（如「名古屋美食街」「海濱步道」）。這類名稱在 Google Maps 上查無單一對應地點，容易被地點搜尋誤配對到同名的其他城市/國家（實際發生過：「海洋公園」配對到香港、「海濱步道」配對到新北市八里）。規則 17 描述移動日抵達後的活動類型時，也特別註明那些字眼只是類型舉例，不可直接當成景點名稱抄進去。
- **餐廳規則（規則 12、15）**：禁止用「當地餐廳」「機場餐廳」等泛稱，且同一行程內餐廳/景點不得重複——這條規則的嚴謹程度後來被沿用到規則 16 的景點名稱規範上。
- **`waypointCity` 必填（規則 19）**：每天必須誠實填寫實際所在城鎮，一般情況下等於 arrival 或 return 城市，只有漸進路線才會出現中途城鎮名稱。

### 注意事項
- 這個檔案不直接呼叫 OpenAI —— 純粹是字串組裝與資料修復，實際 API 呼叫在 `scripts/seed-test-data.ts` 和 `src/app/api/v1/generate-stream/route.ts`。
- `repairMissingTransitDay`（舊版函式，用啟發式規則猜測移動日該插在哪一天）已被移除，因為新的 prompt 設計讓 AI 自己直接生成正確數量與位置的移動日，不再需要事後用「40%-80% 區間挑天數最少的一天」這種不精準的猜測方式補救。

---

## 2. `validateItinerary.ts` — 行程結構驗證

### 用途
輸入一份 AI 生成的行程 JSON，檢查它是否符合結構性規則，回傳 `ValidationIssue[]`（含 `severity: "error" | "warning"`、`code`、`message`、可選的 `day`）。**只做結構檢查，不呼叫任何外部 API**，執行速度快、可重複跑。

### 檢查項目一覽

| 檢查 | Code | Severity |
|---|---|---|
| 天數是否符合航班日期區間 | `DAY_COUNT_MISMATCH` | error |
| `day` 編號是否從 1 連續遞增 | `DAY_NUMBER_SEQUENCE` | error |
| 多城市行程缺少移動日 | `TRANSIT_DAY_MISSING` | error |
| 單城市行程卻有移動日 | `TRANSIT_DAY_UNEXPECTED` | error |
| 移動日數量是否合理（目前允許 1 個以上，見下方註記） | `TRANSIT_DAY_DUPLICATE` | error |
| 移動日缺少 `transitTo` | `TRANSIT_DAY_NO_TRANSITTO` | error |
| 移動日 `transitTo` 不是預期城市 | `TRANSIT_DAY_WRONG_CITY` | error |
| 移動日卻填了住宿 | `TRANSIT_DAY_HAS_ACCOMMODATION` | warning |
| 非移動日/非最後一天缺少住宿 | `ACCOMMODATION_MISSING` | error |
| 最後一天卻填了住宿 | `LAST_DAY_HAS_ACCOMMODATION` | warning |
| 單日景點少於 2 個 | `DAY_TOO_FEW_STOPS` | warning |
| 單日缺少三餐推薦 | `DAY_MISSING_MEALS` | warning |
| 單日所有景點的 `time_of_day` 都相同 | `STOPS_ALL_SAME_TIME` | warning |
| 去程抵達時間晚，但第一天排了 morning 景點 | `FIRST_DAY_ARRIVAL_CONFLICT` | warning |
| 回程出發時間早，但最後一天排了 evening 景點 | `LAST_DAY_DEPARTURE_CONFLICT` | warning |

### 注意事項 — `TRANSIT_DAY_DUPLICATE` 的語意已經過時
這個檢查的原始假設是「多城市行程只能有 1 個移動日」，寫死在 `transitDays.length > 1` 就報錯。但 `itineraryGen.ts` 的 prompt 現在明確支援「漸進路線可以有多個 `isTransitDay: true`」（見上方 `buildSystemPrompt` 說明）。這代表：
- **對於真正的漸進多段路線（如 LA→大蘇爾→SF、NY→DC→Savannah→Miami），這條檢查目前會誤判為錯誤**，即使那是完全合理、AI 誠實生成的行程。
- `scripts/seed-test-data.ts` 的 `RETRY_CODES` 集合把 `TRANSIT_DAY_DUPLICATE` 也列入了會觸發 retry 的錯誤碼——這代表目前跑 seed 時，多段漸進路線可能會被不必要地重新生成，因為驗證邏輯還沒跟上 prompt 的新設計。**這是本檔案已知需要更新的地方**：應該讓 `TRANSIT_DAY_DUPLICATE`（或改個新 code）只在移動日數量明顯不合理（例如超過總天數的一半）時才報錯，而不是單純大於 1 就報錯。

### 被誰使用
- `scripts/seed-test-data.ts`：生成後立即驗證，決定是否 retry。
- `src/app/api/v1/generate-stream/route.ts`：正式生成流程中同樣會驗證（做法待確認是否也複用同一份 RETRY_CODES 邏輯）。

---

## 3. `validateGeography.ts` — 同天景點距離檢查（⚠️ 目前未被引用）

### 用途
檢查同一天內相鄰兩個景點的直線距離（haversine），超過 50km 就回報 `STOPS_TOO_FAR_APART` warning，理由通常是「地點搜尋配對錯誤」或「行程排太緊湊」。

### 現狀
用 `grep` 搜尋全專案，除了自己這個檔案，**沒有任何地方 import 它**。對照 git log 訊息「switch geography validation to synchronous haversine distance instead of a live Distance Matrix API call」，這應該是預期要接在某個 API route 或驗證流程裡的功能，但目前處於「寫好了但沒接線」的狀態。

實際上專案裡真正在跑的同天距離檢查是 `scripts/check-place-data.ts`（獨立腳本，邏輯與這裡幾乎一樣，但是直接寫在腳本裡，沒有共用這個檔案的函式）——這是一個值得之後重構的重複邏輯。

---

## 4. `distanceMatrix.ts` — 距離計算

### 用途
提供兩種距離計算方式：
1. `haversineKm(lat1, lng1, lat2, lng2)` — 純數學直線距離，不需要 API key，同步執行。`validateGeography.ts` 和多支 `scripts/*.ts` 都用這個函式做「兩地是否距離過遠」的快速檢查。
2. `getDistance(origin, destination, mode)` — 呼叫 Google Distance Matrix API，取得實際交通距離與時間（考慮路網，不是直線距離）。`getDistancesForStopPairs` 是它的批次版本，用於一天內連續景點兩兩配對計算。

### 被誰使用
- `src/app/api/v1/days/[dayId]/recalculate-transport/route.ts`：重新計算某天景點間的交通時間。
- `src/app/api/v1/itinerary/[id]/enrich-all-stops/route.ts`：批次補充座標時附帶距離資訊。

### 注意事項
- `getDistance` 需要 `GOOGLE_PLACES_API_KEY`（沿用同一把 key，Distance Matrix 與 Places API 是同一組 Google Maps Platform key）。
- 呼叫失敗（HTTP 錯誤、`status !== "OK"`）一律回傳 `null`，呼叫端需自行處理缺值情況。

---

## 5. `fetchCityRestaurants.ts` — 城市餐廳/景點清單抓取

### 用途
在生成行程前，先用 Google Places **Nearby Search**（不是 Text Search）抓一份「該城市真實存在的餐廳/景點清單」，把清單塞進 system prompt，要求 AI 優先從清單裡選，而不是憑空編造店名。這是防止 AI 生成「當地咖啡館」這類泛稱、或生成查無此店的虛構餐廳的第一道防線。

### 主要匯出

| 函式 | 功能 |
|---|---|
| `fetchCityRestaurants(iataCode, apiKey, budget?, maxCount=20)` | 依城市 + 預算等級抓餐廳清單 |
| `fetchCityAttractions(iataCode, apiKey, maxCount=15)` | 依城市抓景點清單（目前似乎未被 route 呼叫，可能是後續功能的準備） |
| `fetchNearbyPlaceCandidates(coords, apiKey, types, radius, maxCount=8, priceLevels?)` | 通用版本，直接傳座標而非 IATA 代碼，保留 `placeId`/`lat`/`lng`/`address`，給 stop-suggestions、accommodation regenerate 等需要真實地點資料的 route 用 |
| `getLodgingTypes(budget?)` / `getPriceLevels(budget?)` | 依旅客預算等級（`budget`/`moderate`/`luxury`）挑選對應的住宿 Table A 分類與 `priceLevels`，給住宿推薦用 |
| `buildRestaurantHintsPrompt(cityEntries, budget?)` | 把抓到的餐廳清單格式化成要塞進 prompt 的文字段落 |
| `buildAttractionHintsPrompt(cityEntries)` | 同上，但給景點用 |
| `getIataCoords(iataCode)` | 查表拿城市中心座標 |

### 注意事項
- **`IATA_COORDS` 是寫死的城市中心座標表**，只涵蓋 seed scenario 用到的機場代碼（東亞、歐洲、大洋洲、北美、非洲各幾個）。如果之後 seed 新增新地區（例如新的機場代碼），這裡要記得同步補上，否則 `fetchCityRestaurants`/`fetchCityAttractions` 會直接回傳空陣列（找不到座標就靜默跳過，不會報錯）。
- 這裡的「城市中心點」概念跟 `scripts/enrich-all-itineraries.ts` 裡用來做 location bias 防止地點誤配對的 city-center 邏輯是分開的兩套（一套寫死表格，一套動態呼叫 Places API 現查），沒有共用。

---

## 6. `placeCache.ts` — 地點快取層

### 用途
封裝 `Place` / `PlaceQuery` 兩張表的存取，是所有「查詢字串 → Google Places 結果」快取邏輯的唯一正式入口（`scripts/*.ts` 裡另外手刻了幾份幾乎一樣的邏輯，屬於歷史包袱，見下方注意事項）。

### 主要匯出

| 函式 | 功能 |
|---|---|
| `lookupByQuery(query)` | 用快取 key（通常是 `"${景點名稱} ${城市}"`）查詢是否已有結果 |
| `lookupByPlaceId(placeId)` | 用 Google Place ID 直接查 |
| `upsertPlace(query, data)` | 寫入/更新 Place 資料，同時建立 query → placeId 的映射 |

### 資料模型
- `Place`：以 Google `placeId` 為主鍵，存 name/address/lat/lng/rating。
- `PlaceQuery`：以查詢字串為主鍵，指向一個 `Place`。同一個地點可以被多個不同查詢字串命中（例如「金門大橋 舊金山」和「Golden Gate Bridge」可能都指向同一個 placeId）。

### 注意事項——快取 key 帶有城市提示字串，這是誤配對問題的根源之一
因為 cache key 是 `"${stop.name} ${cityHint}"`，如果某天的 `waypointCity` 標錯（例如途經城市被誤標成起點城市），查詢字串本身就帶有錯誤的城市提示，會讓 Google Places 從一開始就傾向搜到錯誤城市的同名地點，而且錯誤結果還會被快取下來，之後同樣的查詢字串會一直命中同一個錯的結果，直到手動用 `scripts/reset-bad-places.ts` 清除。這也是為什麼「多段移動」的 `waypointCity` 正確性（見 `itineraryGen.ts` 的 `tagWaypointCities`）對地點資料品質這麼重要。

### 被誰使用
- `src/app/api/v1/days/[dayId]/accommodation/enrich/route.ts`
- `src/app/api/v1/itinerary/[id]/enrich-all-stops/route.ts`
- `src/app/api/v1/stops/[stopId]/enrich/route.ts`
- `scripts/seed-test-data.ts`（seed 時期的景點補充）

---

## 7. `iataCity.ts` — IATA 代碼對照表

### 用途
單純的查表函式：`iataToCity("NRT")` → `"東京"`。查不到的代碼會原樣回傳（例如冷門機場代碼），不會報錯。

### 涵蓋範圍
東北亞、東南亞、大洋洲、歐洲、中東、北美、台灣，共約 60 個機場代碼。同一城市的多個機場會對應同一個城市名（如 `CDG`/`ORY` 都是「巴黎」，`NRT`/`HND` 都是「東京」）。

### 注意事項
- 這份表跟 `fetchCityRestaurants.ts` 的 `IATA_COORDS` 表是分開維護的兩份資料——`iataCity.ts` 只有城市中文名，沒有座標；`IATA_COORDS` 只有座標，且涵蓋範圍更小（只涵蓋 seed 場景實際用到的機場）。新增地區時兩邊都要記得更新。

---

## 8. `schemas.ts` — Zod Schema 定義

### 用途
定義整個專案的核心資料型別與執行期驗證規則，`FlightInfo`、`TripPreferences`、`Itinerary` 等 TypeScript 型別都是從這裡的 Zod schema 用 `z.infer` 推導出來的（單一事實來源，型別跟驗證規則不會不同步）。

### 主要 Schema

| Schema | 對應型別 | 說明 |
|---|---|---|
| `FlightInfoSchema` | `FlightInfo` | 去回程機場代碼、日期、時間 |
| `TripPreferencesSchema` | `TripPreferences` | 步調/預算/興趣/人數 |
| `AccommodationSchema` | — | 住宿建議，含選填的地圖資料（placeId/lat/lng/address/rating/priceLevel/bookingUrl） |
| `StopSchema` | — | 單一景點，含時段、時長、交通方式、預估費用 |
| `DaySchema` | — | 單日行程，含 `isTransitDay`/`transitTo`/`waypointCity` |
| `ItinerarySchema` | — | 整份行程（`title` + `currency` + `days[]`） |
| `TransitRecommendationSchema` | `TransitRecommendation` | 中途城市推薦（用於「順道去鄰近城市」功能） |

### 注意事項
- `AccommodationSchema` 裡的 `name` 是必填，但實際上 `itineraryGen.ts` 的 prompt 規則 7 明確說明只需要 `area` + `reason`，不需要具體飯店名稱——這代表**AI 實際生成的 accommodation 物件通常沒有 `name` 欄位**，跟這裡的 schema 定義有落差（Zod 這裡沒有把 `name` 設成 optional）。這可能只是型別定義暫時沒跟上 prompt 規則調整，也可能是入庫前另有一層轉換補上預設值，需要進一步確認生成流程裡是否有做轉換，否則嚴格用這個 schema 做 `parse()`（而非容錯度較高的 `safeParse`）可能會在正式流程中噴錯。
- `transitTo` 用了 `.nullish().transform(v => v ?? undefined)`，代表 AI 回傳 `null` 或不填都會被正規化成 `undefined`，呼叫端只需要處理一種「沒有值」的情況。

---

## 9. `db.ts` — Prisma Client 單例

### 用途
提供整個 Next.js app 共用的 Prisma Client 實例，並用 Prisma Client Extension 讓 `Itinerary.days` / `Itinerary.config` 這兩個欄位在讀寫時自動做 JSON 字串 ↔ 物件的轉換（因為底層是 SQLite，`Json` 型別實際上是用 `String` 欄位模擬的）。

### 運作方式
- `result.itinerary.days.compute` / `config.compute`：讀取時如果欄位是字串就自動 `JSON.parse`。
- `query.itinerary.create` / `update`：寫入時如果傳入的是物件就自動 `JSON.stringify`。
- 這樣一來，`src/app/api/v1/**` 裡的程式碼可以直接把 `days` 當成物件/陣列操作，不用每次手動 parse/stringify。

### 注意事項——這跟 `scripts/*.ts` 的用法不一致
所有 `scripts/*.ts`（`seed-test-data.ts`、`check-place-data.ts`、`enrich-all-itineraries.ts`、`reset-bad-places.ts` 等）都是自己 `new PrismaClient()`，**沒有使用這個擴充過的 client**，所以在腳本裡讀寫 `itinerary.days` 都要手動 `JSON.parse`/`JSON.stringify`。這是刻意的（腳本是純 Node 環境執行，沒有走 Next.js 的 module alias `@/lib/db`），但代表兩邊的 Prisma 使用方式不一致，之後如果要把某段腳本邏輯搬進 API route（或反過來），要記得補上/拿掉這層手動轉換。

- `globalForPrisma` 的 pattern 是為了避免 Next.js dev 模式下 hot reload 重複建立連線（開發模式才會存到 global，正式環境每次都建立新的）。
- `j(val)` 是給某些需要手動確保型別是 `string` 的地方用的小工具函式。

### 被誰使用
- 幾乎所有 `src/app/api/v1/**` route 都會 import。

---

## 10. `openai.ts` — OpenAI Client 單例

### 用途
就是一個 `new OpenAI({ apiKey: ... })` 的單例匯出，缺少 `OPENAI_API_KEY` 環境變數時**模組載入當下就會直接 throw**（不是呼叫時才報錯）。

### 注意事項
- 因為是 import 時就檢查，任何有 import 這個檔案的 route，只要 `.env` 沒設定 `OPENAI_API_KEY`，整個 route 在 build/載入階段就會壞掉，不是執行期才發現。開發時如果遇到「明明沒呼叫這支 API 卻噴 Missing OPENAI_API_KEY」，通常是因為某個共用檔案間接 import 到這裡。

---

## 11. `mockAi.ts` — AI 呼叫的假資料開關

### 用途
讓前端/UI 測試不需要真的打 OpenAI API 就能測試三種情境：

| `MOCK_AI` 值 | 行為 | 用途 |
|---|---|---|
| `error` | 立即回傳 500 | 測試錯誤處理 UI（fallback 畫面） |
| `slow` | 等待 3.5 秒才回傳 fixture | 測試 loading spinner |
| `1`（或任何其他非空值）| 立即回傳 fixture | 最快速的 UI 測試，不呼叫真實 API |

### 主要匯出
- `getMockMode()`：讀 `process.env.MOCK_AI`，回傳對應模式。
- `mockDelay(ms=3500)`：純粹的 `setTimeout` 包裝。
- `MOCK_FIXTURES`：寫死的假資料（住宿候選清單 `accommodationCandidates`、單一住宿 `accommodation`、3 個中途城市推薦、3 個假景點候選 `stopCandidates`）。

### 注意事項
- 只在 `.env.local` 設定，不應該出現在正式環境的 `.env`。
- 目前有 4 支 route 有接這個開關（`accommodation/regenerate`、`accommodation/select`、`stop-suggestions`、`transit-recommendations`），不是全域生效——像 `generate-stream/route.ts`（主要生成流程）目前沒有接 `MOCK_AI`，代表沒辦法純用 mock 模式測試完整生成流程，仍然需要真實 OPENAI_API_KEY。

---

## 已知的技術債 / 之後可以整理的地方

1. **`validateGeography.ts` 沒有被引用**——邏輯跟 `scripts/check-place-data.ts` 裡手刻的版本重複，應該讓後者改成呼叫前者，或是把 `validateGeography` 真正接進生成流程的驗證步驟裡。
2. **`validateItinerary.ts` 的 `TRANSIT_DAY_DUPLICATE` 語意過時**——`itineraryGen.ts` 的 prompt 已經支援合理的多段移動日，但驗證邏輯還停留在「只能有 1 個移動日」的假設，需要更新判斷條件（見上方第 2 節的詳細說明）。
3. **`scripts/*.ts` 和 `src/lib/placeCache.ts` 的快取邏輯是兩套平行實作**——腳本自己 `new PrismaClient()` 手動處理 upsert，跟 `placeCache.ts` 提供的 `upsertPlace`/`lookupByQuery` 邏輯幾乎一樣，只是沒有共用同一份程式碼。
4. **`iataCity.ts` 與 `fetchCityRestaurants.ts` 的 `IATA_COORDS` 是兩份分開維護的機場資料表**，涵蓋範圍不同步，新增地區時容易漏改其中一份。
5. **`AccommodationSchema.name` 為必填，但 prompt 規則實際只要求 `area`/`reason`**——型別定義與 prompt 實際輸出有落差，需確認是否有轉換層，或該把 schema 改成 optional。

# 功能 × 技術對應筆記

> 整理目的：快速看出「這個功能是用什麼技術做的、程式碼在哪」，方便口頭講解專案或準備面試時查閱。
> 詳細說明另見 [docs/api-overview.md](api-overview.md)、[docs/components.md](components.md)、[docs/lib.md](lib.md)、[docs/database.md](database.md)。

---

## 技術棧總覽

| 分類 | 技術 | 版本 | 用途 |
|---|---|---|---|
| 框架 | Next.js | 16.1.6 | App Router、API Routes、SSR |
| UI | React | 19.2.3 | 元件與狀態管理 |
| 語言 | TypeScript | ^5 | 全專案型別 |
| 樣式 | Tailwind CSS | ^4 | 版面與樣式 |
| 資料驗證 | Zod | ^4.3.6 | Schema 定義 + 執行期驗證，型別由 schema 推導 |
| ORM / DB | Prisma Client + SQLite | ^5.22.0 | 資料持久化 |
| AI | OpenAI SDK | ^6.22.0 | 行程生成、景點/住宿推薦、行程重建（streaming + JSON mode） |
| 地圖 | `@vis.gl/react-google-maps` | ^1.7.1 | 行程地圖視圖（marker、polyline、InfoWindow） |
| 外部 API | Google Places API（Text Search / Nearby Search）、Google Distance Matrix API | — | 真實地點資料、距離與交通時間 |
| 外部 API | open.er-api.com | — | 免費匯率查詢（無需 API key，供花費預估換算台幣） |
| 拖曳互動 | `@dnd-kit/core` / `@dnd-kit/sortable` / `@dnd-kit/utilities` | ^6 / ^10 / ^3 | 景點排序、城市清單排序 |
| 測試 | Vitest | ^4.1.11 | 單元測試 + 整合測試（獨立 config） |
| 測試 | Playwright | ^1.60.0 | E2E / 瀏覽器測試 |

---

## 功能 × 技術對應表

### 1. AI 行程生成（串流）

使用者輸入航班資訊與偏好，AI 即時串流產出完整多天行程。

| 項目 | 內容 |
|---|---|
| 技術 | OpenAI streaming completion、SSE (`text/event-stream`)、Zod 驗證、規則式結構驗證 |
| API | [src/app/api/v1/generate-stream/route.ts](../src/app/api/v1/generate-stream/route.ts) |
| 核心邏輯 | [src/lib/itineraryGen.ts](../src/lib/itineraryGen.ts)（prompt 組裝）、[src/lib/validateItinerary.ts](../src/lib/validateItinerary.ts)（結構驗證）、[src/lib/schemas.ts](../src/lib/schemas.ts)（Zod schema） |
| 前端 | [src/components/StreamingPreview.tsx](../src/components/StreamingPreview.tsx)（邊收邊解析不完整 JSON 顯示預覽） |
| 輔助 | [src/lib/iataCity.ts](../src/lib/iataCity.ts)（IATA→城市）、[src/lib/fetchCityRestaurants.ts](../src/lib/fetchCityRestaurants.ts)（真實餐廳清單注入 prompt，防止 AI 編造店名） |

### 2. 行程檢視（列表 / 地圖雙視圖）

| 項目 | 內容 |
|---|---|
| 技術 | React 狀態管理、`@vis.gl/react-google-maps`（marker/polyline/InfoWindow） |
| 頁面 | [src/app/view/[id]/page.tsx](../src/app/view/%5Bid%5D/page.tsx) |
| 元件 | [src/components/ViewContent.tsx](../src/components/ViewContent.tsx)（主容器，列表/地圖切換、路線麵包屑、花費側欄）、[src/components/ItineraryMap.tsx](../src/components/ItineraryMap.tsx)（地圖）、[src/components/ItineraryCard.tsx](../src/components/ItineraryCard.tsx)（唯讀卡片） |
| 行程列表頁 | [src/app/itineraries/page.tsx](../src/app/itineraries/page.tsx) + [src/components/ItineraryList.tsx](../src/components/ItineraryList.tsx) |

### 3. 拖曳排序與行內編輯

| 項目 | 內容 |
|---|---|
| 技術 | `@dnd-kit/core`（PointerSensor/TouchSensor/KeyboardSensor）、`@dnd-kit/sortable` |
| 元件 | [src/components/EditableItineraryCard.tsx](../src/components/EditableItineraryCard.tsx)（拖曳、CRUD、摺疊）、[src/components/SortableStop.tsx](../src/components/SortableStop.tsx)（可拖曳單元）、[src/components/StopDragPreview.tsx](../src/components/StopDragPreview.tsx)（拖曳浮動預覽） |
| API | [src/app/api/v1/stops/[stopId]/route.ts](../src/app/api/v1/stops/%5BstopId%5D/route.ts)（編輯/刪除）、[src/app/api/v1/stops/reorder/route.ts](../src/app/api/v1/stops/reorder/route.ts)（排序落地）、[src/app/api/v1/days/[dayId]/stops/route.ts](../src/app/api/v1/days/%5BdayId%5D/stops/route.ts)（新增景點） |

### 4. 景點 AI 重新生成 / 候選建議（含批次編輯本日）

| 項目 | 內容 |
|---|---|
| 技術 | OpenAI JSON mode（單點重生）、Google Places Nearby Search（真實候選，依 `rankPreference: POPULARITY` 排序）、Haversine 距離過濾可疑候選 |
| API | [src/app/api/v1/stops/[stopId]/regenerate/route.ts](../src/app/api/v1/stops/%5BstopId%5D/regenerate/route.ts)、[src/app/api/v1/days/[dayId]/stop-suggestions/route.ts](../src/app/api/v1/days/%5BdayId%5D/stop-suggestions/route.ts) |
| 前端 | [src/components/DayBulkEditPanel.tsx](../src/components/DayBulkEditPanel.tsx)（批次挑選候選加入本日） |
| lib | [src/lib/fetchCityRestaurants.ts](../src/lib/fetchCityRestaurants.ts)（`fetchNearbyPlaceCandidates`）、[src/lib/distanceMatrix.ts](../src/lib/distanceMatrix.ts)（`haversineKm`）、[src/lib/placeCache.ts](../src/lib/placeCache.ts) |

### 5. 住宿推薦與管理

| 項目 | 內容 |
|---|---|
| 技術 | Google Places Nearby Search（依預算挑選住宿類型/價位，**不經 AI**，全程真實資料） |
| API | [src/app/api/v1/days/[dayId]/accommodation/enrich/route.ts](../src/app/api/v1/days/%5BdayId%5D/accommodation/enrich)、`accommodation/regenerate`（同資料夾）、`accommodation/select`（同資料夾）、含整合測試 [accommodation-flow.integration.test.ts](../src/app/api/v1/days/%5BdayId%5D/accommodation/accommodation-flow.integration.test.ts) |
| 前端 | `EditableItineraryCard` 內的 `AccommodationPicker` |

### 6. 重新規劃行程精靈（城市層級重建，含順路/周邊推薦）

專案中最複雜的功能：以城市為單位新增/移除、調整天數、決定哪些既有天保留，最後一次整份重建行程。

| 項目 | 內容 |
|---|---|
| 技術 | Zod schema 驗證前端送出的城市清單、單一 transaction 整包覆寫、AI 平行生成（`Promise.all`）、`@dnd-kit` 城市排序 |
| API | [src/app/api/v1/itinerary/[id]/restructure/route.ts](../src/app/api/v1/itinerary/%5Bid%5D/restructure/route.ts)（套用端點）、[src/app/api/v1/itinerary/[id]/transit-recommendations/route.ts](../src/app/api/v1/itinerary/%5Bid%5D/transit-recommendations/route.ts)（AI 推薦順路城市）、[src/app/api/v1/places/search/route.ts](../src/app/api/v1/places/search/route.ts)（搜尋城市/必去景點） |
| 前端 | [src/components/RestructurePanel.tsx](../src/components/RestructurePanel.tsx)（四步驟精靈）、[src/components/TransitRecommendationCard.tsx](../src/components/TransitRecommendationCard.tsx)（推薦卡片） |
| lib | [src/lib/itineraryCityGen.ts](../src/lib/itineraryCityGen.ts)（單一城市內容生成：移動日/觀光日/住宿餐食）、[src/lib/nearestCity.ts](../src/lib/nearestCity.ts)（景點自動歸類到城市）、[src/lib/placesTextSearch.ts](../src/lib/placesTextSearch.ts)（城市搜尋 + 中心座標快取） |

### 7. 交通重算

| 項目 | 內容 |
|---|---|
| 技術 | Google Distance Matrix API（真實距離/開車時間）+ AI 推算交通描述 |
| API | [src/app/api/v1/days/[dayId]/recalculate-transport/route.ts](../src/app/api/v1/days/%5BdayId%5D/recalculate-transport/route.ts) |
| lib | [src/lib/distanceMatrix.ts](../src/lib/distanceMatrix.ts) |

### 8. 刪除還原（垃圾桶）

| 項目 | 內容 |
|---|---|
| 技術 | Prisma model `DeletedDay`（保留被移除天的完整 JSON 與原始索引） |
| 頁面 | [src/app/view/[id]/trash/page.tsx](../src/app/view/%5Bid%5D/trash/page.tsx) + `TrashView` 元件 |
| 資料表 | `DeletedDay`，見 [docs/database.md](database.md) |
| 寫入來源 | `restructure` route 整份重建時，未勾選保留的天寫入此表 |

### 9. 地點資料快取層

| 項目 | 內容 |
|---|---|
| 技術 | Prisma model `Place` / `PlaceQuery`（查詢字串 → Google Place 結果的映射快取，避免重複打 API） |
| lib | [src/lib/placeCache.ts](../src/lib/placeCache.ts) |
| 資料表 | `Place`、`PlaceQuery`，見 [docs/database.md](database.md) |

### 10. 花費預估與匯率換算

| 項目 | 內容 |
|---|---|
| 技術 | 純函式計算（景點/餐費/住宿加總）、免費匯率 API（`open.er-api.com`，Next.js `fetch` cache `revalidate: 21600` 做每日快取） |
| API | [src/app/api/v1/exchange-rate/route.ts](../src/app/api/v1/exchange-rate/route.ts) |
| lib | [src/lib/costCalculations.ts](../src/lib/costCalculations.ts)（`calculateStopsCost`/`calculateMealsCost`/`calculateDayTotalCost`，供 `EditableItineraryCard` 與 `ViewContent` 共用，避免兩處加總邏輯不同步） |

### 11. 資料庫

| 項目 | 內容 |
|---|---|
| 技術 | Prisma ORM + SQLite；`days`/`config` 欄位以 JSON 字串存放（SQLite 無原生 Json 型別），透過 Prisma Client Extension 自動序列化/反序列化 |
| Schema | [prisma/schema.prisma](../prisma/schema.prisma) |
| 封裝 | [src/lib/db.ts](../src/lib/db.ts) |
| 資料表 | `User`、`Itinerary`、`Place`、`PlaceQuery`、`DeletedDay`，詳見 [docs/database.md](database.md) |

### 12. 開發輔助：Mock 模式

| 項目 | 內容 |
|---|---|
| 技術 | 環境變數 `MOCK_AI` 切換三種假資料情境（error / slow / 立即回傳），供前端測試不打真實 OpenAI/Google API |
| lib | [src/lib/mockAi.ts](../src/lib/mockAi.ts) |

### 13. 測試

| 項目 | 內容 |
|---|---|
| 單元測試 | Vitest，如 [src/lib/distanceMatrix.test.ts](../src/lib/distanceMatrix.test.ts)、[src/lib/priceLevelCost.test.ts](../src/lib/priceLevelCost.test.ts)、[src/lib/validateGeography.test.ts](../src/lib/validateGeography.test.ts) |
| 整合測試 | 獨立 config [vitest.integration.config.mts](../vitest.integration.config.mts)，如 [accommodation-flow.integration.test.ts](../src/app/api/v1/days/%5BdayId%5D/accommodation/accommodation-flow.integration.test.ts) |
| E2E | Playwright（`tests/` 目錄，含 `global-setup.ts`） |

---

## 依「用到的外部服務」快速索引

| 外部服務 | 用在哪些功能 |
|---|---|
| OpenAI API | 行程生成、景點重生、景點描述補全、順路城市推薦、重新規劃行程的新城市內容生成 |
| Google Places API（Text/Nearby Search）| 餐廳/景點清單注入 prompt、景點候選建議、住宿候選、城市/景點搜尋、地理資訊補全（enrich） |
| Google Distance Matrix API | 交通重算 |
| Google Maps（`@vis.gl/react-google-maps`）| 行程地圖視圖 |
| open.er-api.com | 花費預估的台幣匯率換算 |

# Components 文件

本文件說明 `src/components/` 下所有 React 元件的功能、Props 介面與元件間的依賴關係。

---

## 目錄

- [ItineraryCard](#itinerarycard)
- [EditableItineraryCard](#editableitinerarycard)
- [SortableStop](#sortablestop)
- [StopDragPreview](#stopdragpreview)
- [StreamingPreview](#streamingpreview)
- [ItineraryMap](#itinerarymap)
- [ItineraryList](#itinerarylist)
- [TransitRecommendationsPanel](#transitrecommendationspanel)
- [TransitRecommendationCard](#transitrecommendationcard)
- [WaypointCart](#waypointcart)
- [ViewContent](#viewcontent)

---

## ItineraryCard

**路徑**：[src/components/ItineraryCard.tsx](../src/components/ItineraryCard.tsx)

### 功能

唯讀行程卡片，純顯示用途。將完整的 `Itinerary` 物件渲染成依天數分組的景點列表，不提供任何編輯功能。

### Props

| Prop | 型別 | 說明 |
|------|------|------|
| `data` | `Itinerary` | 完整行程資料 |

### 行為

- 顯示行程標題與總天數
- 每天一個卡片，標頭顯示漸層藍色背景、天數、主題與當日總時長
- 景點以編號清單顯示，每筆包含名稱、描述與停留時間
- 不與後端 API 互動，完全靜態渲染

---

## EditableItineraryCard

**路徑**：[src/components/EditableItineraryCard.tsx](../src/components/EditableItineraryCard.tsx)

### 功能

功能完整的可編輯行程卡片，是行程檢視頁的核心元件。支援景點的拖曳排序（同天內及跨天）、行內編輯、刪除、AI 重新生成、住宿推薦管理、餐廳推薦顯示，以及多城市跨國移動日的視覺呈現。

### Props

| Prop | 型別 | 說明 |
|------|------|------|
| `data` | `{ success: boolean; id: string; data: Itinerary }` | 後端回傳的完整行程物件 |
| `onUpdate` | `() => void` (optional) | 任何資料異動後觸發，通常用來重新 fetch 行程 |
| `onExploreBorder` | `() => void` (optional) | 點擊「探索更多邊境城市」時觸發 |
| `hideCostSummary` | `boolean` (default: `false`) | 隱藏頂部財務總覽表格 |

### 主要功能區塊

#### 拖曳排序

使用 `@dnd-kit/core` 實作：

- `PointerSensor`（distance: 8px 啟動）、`TouchSensor`（delay: 200ms）、`KeyboardSensor`
- `handleDragStart`：記錄快照（`snapshotBeforeDrag`）供失敗時還原
- `handleDragOver`：跨天移動時即時更新本地狀態
- `handleDragEnd`：同天重排呼叫 `persistReorder` 並觸發交通重算；跨天移動直接 persist
- 排序失敗時自動還原快照並顯示錯誤訊息

#### 摺疊/展開

- 頂部黏性導覽列（sticky nav）可切換「展開全部 / 折疊全部」
- 每天可個別點擊標頭展開或折疊
- 點擊 Day N 按鈕可平滑捲動到對應天卡片（`scrollIntoView`）

#### 景點 CRUD

| 操作 | API | 方法 |
|------|-----|------|
| 刪除景點 | `/api/v1/stops/:stopId` | `DELETE` |
| 編輯景點 | `/api/v1/stops/:stopId` | `PATCH` |
| AI 重新生成 | `/api/v1/stops/:stopId/regenerate` | `POST` |
| 新增景點 | `/api/v1/days/:dayId/stops` | `POST` |

#### 住宿管理

- 元件掛載時自動對所有缺少 `placeId` 的住宿呼叫 `/api/v1/days/:dayId/accommodation/enrich`
- 使用者可點擊「重新推薦」呼叫 `/api/v1/days/:dayId/accommodation/regenerate`，成功後立即再次 enrich
- 顯示住宿名稱、區域、地址、評分（★）、價位（$$$）及訂房連結

#### 移動日（Transit Day）

- `isTransitDay === true` 的天顯示琥珀色（amber）標頭
- 相鄰兩移動日之間顯示「跨國銜接」紫色連接器，並有「探索更多邊境城市」按鈕
- 非移動日在移動日之後顯示抵達城市地點旗標

#### 交通重算

拖曳結束後呼叫 `/api/v1/days/:dayId/recalculate-transport`，更新各景點的 `transport_from_prev` 與 `time_of_day` 欄位，並在標頭顯示「更新交通中…」旋轉指示。

### 依賴元件

- [SortableStop](#sortablestop)
- [StopDragPreview](#stopdragpreview)

---

## SortableStop

**路徑**：[src/components/SortableStop.tsx](../src/components/SortableStop.tsx)

### 功能

`EditableItineraryCard` 中每個可拖曳景點的顯示與編輯單元。透過 `@dnd-kit/sortable` 的 `useSortable` hook 取得拖曳能力，並在正在編輯或載入時停用拖曳。

### Props

| Prop | 型別 | 說明 |
|------|------|------|
| `stop` | `Stop` | 景點資料 |
| `index` | `number` | 在當天中的顯示順序（從 0 開始） |
| `dayIndex` | `number` | 所屬天在行程中的索引 |
| `currency` | `string` (optional) | 貨幣符號，用於顯示費用 |
| `editingStop` | `EditingStop \| null` | 目前正在編輯的景點狀態 |
| `isLoading` | `boolean` | API 呼叫中（顯示半透明） |
| `isRegenerating` | `boolean` | AI 重新生成中（顯示半透明） |
| `onEdit` | `(stop: Stop) => void` | 點擊編輯按鈕 |
| `onDelete` | `(stopId: string, dayIndex: number) => void` | 點擊刪除按鈕 |
| `onRegenerate` | `(stopId: string) => void` | 點擊重新生成按鈕 |
| `onSaveEdit` | `() => void` | 點擊儲存 |
| `onCancelEdit` | `() => void` | 點擊取消 |
| `onEditChange` | `(updated: EditingStop) => void` | 編輯表單欄位變更 |

### 顯示模式

**一般模式**：顯示景點名稱、描述、停留時間（⏱）、費用（💴 或「免費」），右側有重新生成、編輯、刪除三個 icon 按鈕。

**編輯模式**（`editingStop.id === stop.id`）：行內顯示名稱輸入框、描述 textarea、停留分鐘數輸入框，以及儲存/取消按鈕。編輯時左側拖曳把手停用。

---

## StopDragPreview

**路徑**：[src/components/StopDragPreview.tsx](../src/components/StopDragPreview.tsx)

### 功能

拖曳景點時 `DragOverlay` 呈現的浮動預覽卡片。顯示景點名稱、截斷的描述與停留時間，以藍色邊框標示正在拖曳的元素。

### Props

| Prop | 型別 | 說明 |
|------|------|------|
| `stop` | `Stop` | 被拖曳的景點資料 |

---

## StreamingPreview

**路徑**：[src/components/StreamingPreview.tsx](../src/components/StreamingPreview.tsx)

### 功能

在 AI 串流生成行程過程中即時顯示部分內容。解析尚未完整的 JSON 串流，盡可能提前渲染已生成的天數與景點，尚無資料時顯示骨架載入動畫。

### Props

| Prop | 型別 | 說明 |
|------|------|------|
| `partialData` | `string` | 串流中的 JSON 文字（可能不完整） |
| `days` | `number` | 預期總天數，用於骨架佔位數量 |

### JSON 解析策略

1. 嘗試直接 `JSON.parse`
2. 失敗時用 regex 提取 `"title"` 欄位
3. 再嘗試提取 `"days"` 陣列，補全缺失的 `}` 和 `]` 後解析

解析成功顯示部分行程內容；失敗時顯示骨架動畫（`animate-pulse`）。底部含可展開的「開發者檢視」，顯示原始 JSON 串流（僅開發使用）。

---

## ItineraryMap

**路徑**：[src/components/ItineraryMap.tsx](../src/components/ItineraryMap.tsx)

### 功能

將行程所有景點與住宿渲染在 Google Maps 上，支援按天篩選、點擊地標查看詳情、點擊路線開啟 Google Maps 導航。無座標的景點會自動呼叫後端 API 補充地理資訊。

### Props

| Prop | 型別 | 說明 |
|------|------|------|
| `itineraryId` | `string` | 行程 ID，用於呼叫 enrich API |
| `days` | `Day[]` | 行程天數陣列 |
| `context` | `string` (optional) | 傳給 enrich API 的行程風格描述 |

### 架構

元件分為兩層：

- **`ItineraryMap`（外層）**：管理狀態、呼叫 API、處理天數篩選
- **`MapContent`（內層）**：透過 `useMap()` hook 操作 Google Maps 實例，繪製 polyline 路線並管理 marker 與 InfoWindow

### 地圖功能

| 功能 | 說明 |
|------|------|
| 景點 Marker | 圓形，依天數配色（8 色循環），顯示景點序號 |
| 住宿 Marker | 方形紫色，顯示 🏨 圖示 |
| 路線 Polyline | 依天數配色，箭頭朝行進方向，點擊開啟 Google Maps 導航 |
| InfoWindow | 點擊 marker 顯示名稱、地址、評分、描述（住宿另有訂房連結） |
| 天數篩選 | 頂部按鈕列可切換「全部天數」或單天，自動 fitBounds |

### API 呼叫

| API | 說明 |
|-----|------|
| `POST /api/v1/stops/:stopId/enrich` | 補充景點 lat/lng、address、rating |
| `POST /api/v1/days/:dayId/accommodation/enrich` | 補充住宿 lat/lng |

---

## ItineraryList

**路徑**：[src/components/ItineraryList.tsx](../src/components/ItineraryList.tsx)

### 功能

已儲存行程的列表頁元件（`/itineraries`）。顯示所有行程的卡片式列表，支援點擊進入行程詳頁，以及帶確認步驟的刪除功能。

### Props

| Prop | 型別 | 說明 |
|------|------|------|
| `itineraries` | `ItineraryItem[]` | 行程清單 |

`ItineraryItem` 型別：

```typescript
{
  id: string;
  title: string;
  createdAt: string;
  config: unknown;
}
```

### 行為

- 列表為空時顯示引導提示
- 每筆行程顯示標題、建立日期、天數（從 `config.totalDays` 讀取）、ID 前 8 碼
- 刪除為兩步驟：hover 顯示「刪除」→ 點擊出現「確認刪除 / 取消」→ 確認後呼叫 `DELETE /api/v1/itinerary/:id`，完成後呼叫 `router.refresh()`

---

## TransitRecommendationsPanel

**路徑**：[src/components/TransitRecommendationsPanel.tsx](../src/components/TransitRecommendationsPanel.tsx)

### 功能

順路城市推薦面板，根據行程的出發地與目的地 IATA 代碼，向後端 API 取得途中值得停留的城市清單，供使用者加入待選清單後批次插入行程。

### Props

| Prop | 型別 | 說明 |
|------|------|------|
| `itineraryId` | `string` | 行程 ID |
| `originIata` | `string` | 出發地 IATA 代碼 |
| `destinationIata` | `string` | 目的地 IATA 代碼 |
| `existingStops` | `string[]` (optional) | 已存在的城市名稱，用於過濾重複推薦 |
| `onInserted` | `() => void` | 城市插入完成後的回呼 |
| `maxDays` | `number` (optional) | 機票限制總天數 |
| `currentDays` | `number` (optional) | 行程目前天數 |
| `days` | `DaySummary[]` (optional) | 天數摘要，用於插入位置選擇器 |
| `insertAfterDay` | `number` (optional) | 選定的插入位置 |
| `onSelectInsertAfterDay` | `(day: number) => void` (optional) | 變更插入位置 |
| `cartItems` | `CartItem[]` | 待選清單項目（由父元件管理） |
| `onAddToCart` | `(rec, stayDays) => void` | 加入待選清單 |
| `onRemoveFromCart` | `(name) => void` | 從待選清單移除 |
| `onUpdateCartStayDays` | `(name, days) => void` | 調整停留天數 |
| `onReorderCart` | `(items) => void` | 重新排序待選清單 |
| `onBatchApply` | `() => void` | 批次套用待選清單 |
| `isApplying` | `boolean` | 批次套用進行中 |
| `insertionReason` | `string` (optional) | AI 說明插入邏輯的文字提示 |
| `isSingleCity` | `boolean` (default: `false`) | 單城市模式（起訖相同），改顯示「周邊推薦」 |

### 快取策略

推薦結果以 `sessionStorage` 快取，key 為 `transit-rec-{originIata}-{destinationIata}`。點擊「換一批」時以 `forceRefresh=true` 繞過快取重新 fetch。

### 本地過濾

`existingStops` 變更時（新城市插入後）不重新 fetch，改在本地用 `filter` 移除已存在的城市，避免不必要的 API 呼叫。

### 車程篩選

提供「不限 / ≤ 2 小時 / ≤ 4 小時 / ≤ 8 小時」的車程上限篩選，本地過濾 `transitTimeHours` 欄位。

### 面板狀態

`PanelState`：`"loading" | "ready" | "error" | "empty"`

### 依賴元件

- [TransitRecommendationCard](#transitrecommendationcard)
- [WaypointCart](#waypointcart)

---

## TransitRecommendationCard

**路徑**：[src/components/TransitRecommendationCard.tsx](../src/components/TransitRecommendationCard.tsx)

### 功能

單一推薦城市的卡片元件，顯示城市名稱、類型（城市/國家）、熱門度標籤、交通方式與時間、Top 3 景點，以及可調整停留天數的步進器。

### Props

| Prop | 型別 | 說明 |
|------|------|------|
| `recommendation` | `TransitRecommendation` | 推薦城市資料 |
| `isInCart` | `boolean` | 是否已在待選清單中 |
| `onAddToCart` | `(rec, stayDays) => void` | 加入待選清單 |
| `onRefresh` | `() => void` (optional) | 跳過此推薦（觸發個別刷新） |
| `maxDays` | `number` (optional) | 機票限制天數 |
| `currentDays` | `number` (optional) | 目前行程天數 |

### 顯示邏輯

- 已在待選清單中時，改顯示藍色「已加入待選清單」確認卡片
- 熱門度（`high/medium/low`）以不同色系標籤區分
- 交通方式標籤文字（「車程 / 飛行時間 / 航程」）由 regex 自動判斷 `transitMode` 字串
- 預設停留天數為建議天數的中間值：`ceil((min + max) / 2)`
- 加入後若會超過 `maxDays` 限制，顯示橘色警告說明將壓縮幾天

---

## WaypointCart

**路徑**：[src/components/WaypointCart.tsx](../src/components/WaypointCart.tsx)

### 功能

待選城市清單，讓使用者在批次插入前確認、排序、調整各城市停留天數。清單本身也支援拖曳排序。

### Props

| Prop | 型別 | 說明 |
|------|------|------|
| `items` | `CartItem[]` | 待選城市清單 |
| `currentDays` | `number` | 目前行程天數 |
| `maxDays` | `number` (optional) | 機票限制天數 |
| `days` | `DaySummary[]` (optional) | 天數摘要，用於插入位置選單 |
| `insertAfterDay` | `number` (optional) | 選定的插入位置 |
| `onSelectInsertAfterDay` | `(day: number) => void` (optional) | 變更插入位置 |
| `onUpdateStayDays` | `(name, days) => void` | 調整停留天數 |
| `onRemove` | `(name) => void` | 移除城市 |
| `onReorder` | `(items: CartItem[]) => void` | 拖曳排序結束後更新順序 |
| `onApply` | `() => void` | 批次套用 |
| `isApplying` | `boolean` | 套用進行中 |

### 天數計算

每個城市插入後實際增加天數為 `1（移動日）+ stayDays`，`totalInserted = sum(1 + stayDays)`。若 `currentDays + totalInserted > maxDays` 則顯示橘色警告並說明將壓縮幾天，套用後最終天數顯示為 `maxDays`。

### 子元件：SortableCartItem

內部元件，實作每個清單項目的拖曳把手、名稱顯示、停留天數步進器與移除按鈕。透過 `@dnd-kit/sortable` 的 `useSortable` hook 取得拖曳能力。

---

## ViewContent

**路徑**：[src/components/ViewContent.tsx](../src/components/ViewContent.tsx)

### 功能

行程詳頁（`/view/[id]`）的主要容器元件，整合所有子元件並管理頁面層級的狀態。負責行程資料 fetch、列表/地圖視圖切換、匯率換算、待選清單管理，以及渲染路線麵包屑與花費預估側欄。

### Props

| Prop | 型別 | 說明 |
|------|------|------|
| `id` | `string` | 行程 ID（從 URL 參數取得） |

### 主要狀態

| 狀態 | 說明 |
|------|------|
| `data` | 後端回傳的完整行程物件（`any`） |
| `view` | `"list" \| "map"` 視圖切換 |
| `exchangeRate` | 目前貨幣對台幣匯率，可手動調整 |
| `cartItems` | 待選城市清單（傳遞給 Panel 和 Cart） |
| `insertAfterDay` | 選定的插入位置（預設為天數一半） |
| `insertionReason` | 批次插入後 AI 回傳的說明文字 |

### 版面配置

```
┌──────────────────────────────────────┐
│  ← 新增行程       列表/地圖  已儲存行程  │  ← 頂部導覽
├──────────────────────────────────────┤
│  路線麵包屑（IATA → IATA → ...）       │
├────────────────────┬─────────────────┤
│                    │  花費預估側欄    │
│  主內容            │                 │
│  (列表 或 地圖)    │  順路推薦面板   │
│                    │                 │
│  行程設定摘要      │                 │
└────────────────────┴─────────────────┘
     1fr              360px（sticky）
```

大螢幕（lg）採雙欄：左側主內容、右側 360px sticky 側欄（花費預估 + 順路推薦）。

### 路線麵包屑

`renderRouteBreadcrumb()`：從 `config.flightInfo` 提取出發地、目的地，並掃描 `days` 中的 `waypointCity` 欄位取得使用者插入的中途城市，合併去重後以 IATA 代碼 + 中文名稱呈現，waypoint 以紫色、端點以藍色標示。

### 花費預估

`renderCostSummary()`：顯示各天景點費用 + 餐費小計，以及可調整匯率的台幣換算欄。

### 批次插入（handleBatchApply）

呼叫 `POST /api/v1/itinerary/:id/batch-insert-waypoints`，傳入 `cartItems`、`maxDays`、`insertAfterDay`，成功後清空 cart 並重新 fetch 行程資料。

### 依賴元件

- [EditableItineraryCard](#editableitinerarycard)
- [ItineraryMap](#itinerarymap)
- [TransitRecommendationsPanel](#transitrecommendationspanel)

---

## 元件依賴圖

```
ViewContent
├── EditableItineraryCard
│   ├── SortableStop
│   └── StopDragPreview
├── ItineraryMap
└── TransitRecommendationsPanel
    ├── TransitRecommendationCard
    └── WaypointCart

ItineraryCard          (獨立，唯讀)
ItineraryList          (獨立，行程列表頁)
StreamingPreview       (獨立，生成中預覽)
```

---

## API 端點彙整

元件直接呼叫的後端 API：

| 端點 | 方法 | 呼叫元件 | 說明 |
|------|------|----------|------|
| `/api/v1/itinerary/:id` | `GET` | ViewContent | 取得行程資料 |
| `/api/v1/itinerary/:id` | `DELETE` | ItineraryList | 刪除行程 |
| `/api/v1/itinerary/:id/batch-insert-waypoints` | `POST` | ViewContent | 批次插入中途城市 |
| `/api/v1/itinerary/:id/remove-waypoint` | `DELETE` | EditableItineraryCard | 移除中途城市段落 |
| `/api/v1/itinerary/:id/transit-recommendations` | `POST` | TransitRecommendationsPanel | 取得順路城市推薦 |
| `/api/v1/stops/:stopId` | `DELETE` | EditableItineraryCard | 刪除景點 |
| `/api/v1/stops/:stopId` | `PATCH` | EditableItineraryCard | 更新景點 |
| `/api/v1/stops/:stopId/regenerate` | `POST` | EditableItineraryCard | AI 重新生成景點 |
| `/api/v1/stops/:stopId/enrich` | `POST` | ItineraryMap | 補充景點地理座標 |
| `/api/v1/stops/reorder` | `POST` | EditableItineraryCard | 儲存景點排序 |
| `/api/v1/days/:dayId/stops` | `POST` | EditableItineraryCard | 新增景點 |
| `/api/v1/days/:dayId/recalculate-transport` | `POST` | EditableItineraryCard | 重算交通資訊 |
| `/api/v1/days/:dayId/accommodation/enrich` | `POST` | EditableItineraryCard, ItineraryMap | 補充住宿地理資訊 |
| `/api/v1/days/:dayId/accommodation/regenerate` | `POST` | EditableItineraryCard | AI 重新推薦住宿 |

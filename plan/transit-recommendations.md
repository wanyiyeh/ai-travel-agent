# 智慧接駁推薦 (Smart Transit Recommendations) — 實作計畫

## 背景與架構摘要

- **Stack**: Next.js 14 + TypeScript, Prisma (SQLite), OpenAI API
- **航班資訊來源**: `FlightInfoSchema` 已有 `departureCity` / `arrivalCity` / `returnDepartureCity` (IATA 代號)
- **行程結構**: `Itinerary.days` 為 JSON string，`Stop` 有獨立 DB row
- **現有 API 模式**: REST `/api/v1/`，生成用 streaming

---

## Phase 1 — 型別擴充 (Types & Schema)

### 修改 `src/types/itinerary.ts`

新增 `TransitRecommendation` 型別：

```typescript
export type TransitRecommendation = {
  city: string;
  country: string;
  iataCode?: string;
  transitTimeHours: number;       // 從前一城市的交通時數
  transitMode: string;            // "火車" | "巴士" | "開車"
  suggestedStayDaysMin: number;
  suggestedStayDaysMax: number;
  popularity: "high" | "medium" | "low";
  topAttractions: string[];       // 固定 3 個
  lat: number;
  lng: number;
};
```

擴充 `Day` 型別，加入：

```typescript
export type Day = {
  // ...現有欄位...
  isTransitDay?: boolean;         // 標示跨國移動日
  transitTo?: string;             // 移動目的地城市名
};
```

### 修改 `src/lib/schemas.ts`

對應更新 `DaySchema`，加入 `isTransitDay` 和 `transitTo` optional 欄位。

---

## Phase 2 — API 路由

### 新增 `POST /api/v1/itinerary/[id]/transit-recommendations`

**檔案**: `src/app/api/v1/itinerary/[id]/transit-recommendations/route.ts`

**輸入**:
```json
{
  "originIata": "VIE",
  "destinationIata": "PRG"
}
```

**邏輯**: 呼叫 OpenAI，prompt 描述兩個 IATA 機場之間的地理區域，要求回傳 3~5 個順路城市，每個城市包含交通時數、建議停留天數、Top 3 景點、座標。

**輸出**:
```json
{
  "recommendations": [TransitRecommendation, ...]
}
```

---

### 新增 `POST /api/v1/itinerary/[id]/insert-waypoint`

**檔案**: `src/app/api/v1/itinerary/[id]/insert-waypoint/route.ts`

**輸入**:
```json
{
  "recommendation": TransitRecommendation,
  "stayDays": 2,
  "insertAfterDayIndex": 3
}
```

**邏輯**:
1. 讀取現有行程的 `days` JSON
2. 在 `insertAfterDayIndex` 後插入：
   - 1 個「跨國移動日」(`isTransitDay: true`, `transitTo: city`)
   - `stayDays` 個新城市天數（AI 生成景點 or 空白佔位）
3. 後續所有 day 的 `day` 編號順延
4. 寫回 DB，回傳更新後的完整行程

---

## Phase 3 — UI 元件

### 新增 `src/components/TransitRecommendationsPanel.tsx`

- 顯示在行程編輯器的**右側邊欄**（或行程底部）
- 標題：「順路推薦」+ 簡單地圖連線（使用 `ItineraryMap` 的 Polyline）
- 包含 N 張 `TransitRecommendationCard`
- 觸發時機：行程生成完成後自動出現（條件：`returnDepartureCity !== arrivalCity`，代表異地出發）

### 新增 `src/components/TransitRecommendationCard.tsx`

每張卡片顯示：
- 城市名 + 國旗 emoji
- `維也納 → 布達佩斯  2.5h 火車`
- `建議停留 2–3 天`
- Top 3 必去景點（bullet list）
- 停留天數 stepper（預設取建議值中間）
- **「加入行程」按鈕** → 呼叫 insert-waypoint API

### 修改 `src/components/EditableItineraryCard.tsx`

- 偵測 `day.isTransitDay === true` 時，渲染不同樣式的 Day header
- 加上「跨國移動日 ✈ → 城市名」的視覺區隔 badge

### 修改 `src/components/ItineraryMap.tsx`

- 在出發城市與目的地之間繪製虛線 Polyline
- 在順路推薦城市座標上加上半透明 marker（未加入行程時）
- 加入行程後改為實線 + 正常 marker

---

## Phase 4 — 整合進行程編輯頁

1. 在行程生成完成後（`state === "done"`）檢查 `returnDepartureCity !== arrivalCity`
2. 若條件成立，自動呼叫 `transit-recommendations` API
3. 將結果傳入 `TransitRecommendationsPanel`
4. 點擊「加入行程」後呼叫 `insert-waypoint`，更新本地狀態並重新渲染行程

---

## 實作順序與依賴關係

```
Phase 1 (型別)
    └─ Phase 2a (recommendations API)  ← 無依賴，可先做
    └─ Phase 2b (insert-waypoint API)  ← 依賴 Phase 1
        └─ Phase 3 (UI 元件)           ← 依賴 Phase 2
            └─ Phase 4 (整合)          ← 依賴 Phase 3
```

## 技術決策

| 問題 | 決策 | 原因 |
|------|------|------|
| 交通時間資料來源 | AI 估算 | MVP 不需 Google Maps Distance Matrix API，減少外部依賴 |
| 推薦資料是否入 DB | 不入 DB，純 API 回傳 | 推薦結果是動態的，不需持久化 |
| 景點生成 | AI 生成空白佔位 day，不自動填滿景點 | 避免生成品質不穩，讓使用者自行編輯 |
| 插入位置 | 固定插入在「最後一個原始目的地 day」之前 | 符合 VIE→[中間城市]→PRG 的自然流向 |

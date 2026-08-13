# AI 旅遊助理 — 行程插入升級計畫

> 基準版本：`feat/accommodation-recommendations` 分支  
> 計畫日期：2026-05-22  
> 目標：將「推薦行程插入」從靜態對半切升級為具備 AI 決策、購物車選擇、移動日優化的完整智能顧問體驗

---

## 背景與問題

使用者目前的插入流程：
1. 側邊欄顯示推薦城市 → 點擊「加入行程」→ 後端固定對半切入插入點 → 頁面刷新

**現有痛點：**

| 問題 | 影響 |
|---|---|
| 插入點固定對半切，不考慮行程密度 | 可能在最繁忙的一天前後插入移動日 |
| 每次只能插入一個城市 | 多國旅遊需重複操作，體驗差 |
| 移動日只有交通資訊 | 出發前與抵達後時間完全空白 |
| AI 生成失敗直接顯示技術錯誤 | 使用者感知品質差 |
| 跨國交通卡片無購票或導航連結 | 助理價值不足 |

---

## 功能總覽

| # | 功能 | 難度 | AI 成本 | 優先順序 |
|---|---|---|---|---|
| F1 | 移動日行程優化（Fill the Gaps） | 低 | 低（改 prompt） | **1** |
| F2 | 交通卡片 CTA 按鈕 | 低 | 無 | **2** |
| F3 | 優雅降級 Graceful Degradation | 低 | 無 | **3** |
| F4 | AI 智能插入時間點 | 中 | 中（+1 次 AI 呼叫） | **4** |
| F5 | 多國連續插入購物車 | 高 | 高（批次生成） | **5** |

---

## F1：移動日行程優化（Fill the Gaps）

### 目標

移動日不再只是一筆交通記錄。AI 應同時生成出發城市的早晨微行程與抵達城市的下午遊覽。

**期望結果範例：**
```
08:00  維也納車站附近早餐
09:30  跨國高鐵出發
13:00  布達佩斯飯店 Check-in
14:30  布達佩斯市區半日遊
```

### 影響檔案

- `src/app/api/v1/itinerary/[id]/insert-waypoint/route.ts`
  - 函數：`generateDayStops()`

### 實作步驟

**Step 1 — 擴充 `generateDayStops()` 參數**

```typescript
async function generateDayStops(
  city: string,
  dayTheme: string,
  existingStops: string[],
  fromCity?: string,  // 新增：出發城市
  toCity?: string     // 新增：抵達城市
): Promise<Stop[]>
```

**Step 2 — 區分移動日與停留日的 prompt**

```typescript
const isTransitDay = dayTheme.includes("移動") || dayTheme.includes("Transit");

const prompt = isTransitDay
  ? `
    Generate a transit day schedule from ${fromCity} to ${toCity}.
    Include THREE parts in order:
    1. A morning micro-activity in ${fromCity} near the main station
       (breakfast cafe or quick landmark, before 09:30)
    2. The transit itself with realistic departure/arrival times
    3. A half-day afternoon tour in ${toCity} after hotel check-in
    Return as a JSON array of stop objects.
  `
  : `Generate a full-day itinerary for ${toCity} with 4-6 attractions...`;
```

**Step 3 — 插入主流程帶入城市資訊**

```typescript
const transitStops = await generateDayStops(
  recommendation.name,
  "移動日",
  allExistingStopNames,
  originCityName,       // 從 itinerary config 取得出發城市
  recommendation.name   // 推薦城市名稱作為抵達城市
);
```

### 驗收標準

- [ ] 移動日包含至少 3 個 stops（早晨微行程 / 交通 / 下午遊覽）
- [ ] Stop 的 `time_of_day` 合理分佈（morning / afternoon）
- [ ] 停留日的生成邏輯不受影響

---

## F2：交通卡片 CTA 按鈕

### 目標

在包含跨國交通的 stop 卡片上顯示「查詢購票」與「車站導航」兩個按鈕。

### 影響檔案

- `src/components/EditableItineraryCard.tsx`

### 實作步驟

**Step 1 — 定義跨國交通偵測**

```typescript
const CROSS_BORDER_KEYWORDS = [
  "train", "火車", "鐵路", "高鐵", "Railjet", "EC ", "IC ",
  "bus", "巴士", "FlixBus", "flight", "航班",
];

function isCrossBorderTransit(transportText?: string): boolean {
  if (!transportText) return false;
  return CROSS_BORDER_KEYWORDS.some(kw =>
    transportText.toLowerCase().includes(kw.toLowerCase())
  );
}
```

**Step 2 — 依出發國家選擇購票連結**

```typescript
const BOOKING_LINKS: Record<string, string> = {
  AT: "https://www.oebb.at",
  DE: "https://www.bahn.de",
  FR: "https://www.sncf-connect.com",
  DEFAULT: "https://www.trainline.com",
};

function getBookingUrl(countryCode?: string): string {
  return BOOKING_LINKS[countryCode ?? ""] ?? BOOKING_LINKS.DEFAULT;
}
```

**Step 3 — 在 Stop 卡片加入按鈕**

```tsx
{isCrossBorderTransit(stop.transport_from_prev) && (
  <div className="flex gap-2 mt-2">
    <a
      href={getBookingUrl(stop.countryCode)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50"
    >
      🎫 查詢購票
    </a>
    <a
      href={`https://www.google.com/maps/search/${encodeURIComponent(stop.name + " train station")}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
    >
      📍 車站導航
    </a>
  </div>
)}
```

### 驗收標準

- [ ] 含跨國交通關鍵字的 stop 顯示兩個按鈕
- [ ] 連結在新分頁開啟
- [ ] 無交通資訊的 stop 不顯示按鈕

---

## F3：優雅降級 Graceful Degradation

### 目標

AI 生成失敗時，使用者看到的是溫和的 Fallback 狀態，而非技術錯誤訊息。

### 影響檔案

- `src/components/EditableItineraryCard.tsx` — 住宿 Fallback
- `src/components/TransitRecommendationsPanel.tsx` — 推薦面板 Fallback
- `src/lib/fallback.ts` — 新增工具函數（✨ 新增）

### 實作步驟

**Step 1 — 住宿區塊三種狀態**

```tsx
// 載入中
<div className="text-sm text-gray-500 flex items-center gap-2">
  <Spinner className="w-4 h-4" />
  為您探索 {cityName} 住宿中...
</div>

// 失敗 Fallback
<div className="text-sm text-gray-600 bg-amber-50 rounded p-3">
  <p>準備預訂 {cityName} 的住宿了嗎？</p>
  <a
    href={getHotelSearchUrl(cityName)}
    target="_blank"
    className="text-blue-500 underline text-xs"
  >
    點此搜尋附近飯店 →
  </a>
  <button onClick={handleRegenerate} className="ml-3 text-xs text-gray-400 hover:text-gray-600">
    重新嘗試
  </button>
</div>

// 正常顯示（不變）
<div>{accommodation.name} · {accommodation.area}</div>
```

**Step 2 — 推薦面板 error state 改為溫和重試**

```tsx
// 現在（粗暴）：
<p className="text-red-500">{error}</p>

// 升級後（溫和）：
<div className="text-center py-6">
  <p className="text-sm text-gray-500 mb-3">
    暫時無法取得推薦，稍後再試看看？
  </p>
  <button
    onClick={fetchRecommendations}
    className="text-sm px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700"
  >
    重新整理
  </button>
</div>
```

**Step 3 — `src/lib/fallback.ts` 工具函數**

```typescript
export function getHotelSearchUrl(cityName: string): string {
  return `https://www.google.com/maps/search/hotels+in+${encodeURIComponent(cityName)}`;
}
```

### 驗收標準

- [ ] 住宿失敗時顯示 Fallback 卡片，含有效 Google Hotels 連結
- [ ] 推薦面板失敗時有溫和重試按鈕
- [ ] 成功狀態與現有功能完全相同

---

## F4：AI 智能插入時間點

### 目標

插入前讓 AI 分析行程密度，回傳最佳插入天數與理由。使用者插入後看到 AI 建議說明。

**期望體驗：**
> 「AI 建議您在第 5 天移動，因為前半段景點較密集，且這天銜接最自然。」

### 影響檔案

- `src/app/api/v1/itinerary/[id]/insert-waypoint/route.ts`
- `src/components/TransitRecommendationCard.tsx`

### 實作步驟

**Step 1 — 新增 `findOptimalInsertionDay()` 函數**

```typescript
interface InsertionSuggestion {
  insertAfterDay: number;
  reason: string; // 繁體中文一句話
}

async function findOptimalInsertionDay(
  days: Day[],
  recommendation: TransitRecommendation
): Promise<InsertionSuggestion> {
  const daySummaries = days.map((d, i) => ({
    dayNumber: i + 1,
    theme: d.theme,
    stopCount: d.stops?.length ?? 0,
  }));

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a travel planning assistant. Suggest the best day to insert a new transit destination.",
        },
        {
          role: "user",
          content: `
            Current itinerary: ${JSON.stringify(daySummaries)}
            Destination to insert: ${recommendation.name} (${recommendation.stayDays} days)

            Choose the best insertAfterDay (1 to ${days.length - 1}).
            Consider: fewer stops = natural transition point, avoid splitting first/last day.

            Respond with JSON only:
            { "insertAfterDay": <number>, "reason": "<一句話繁體中文說明>" }
          `,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 100,
    });

    const parsed = JSON.parse(response.choices[0].message.content ?? "{}");
    return {
      insertAfterDay: Math.max(1, Math.min(parsed.insertAfterDay, days.length - 1)),
      reason: parsed.reason ?? "",
    };
  } catch {
    // 降級為對半切
    return { insertAfterDay: Math.ceil(days.length / 2), reason: "" };
  }
}
```

**Step 2 — 替換現有固定對半切**

```typescript
// 舊：
const insertAfterDay = Math.ceil(days.length / 2);

// 新：
const { insertAfterDay, reason } = await findOptimalInsertionDay(days, recommendation);
```

**Step 3 — API response 新增 reason**

```typescript
return NextResponse.json({
  success: true,
  itinerary: updatedItinerary,
  insertionReason: reason, // 新增
});
```

**Step 4 — 前端顯示 AI 理由**

```tsx
// TransitRecommendationCard.tsx
const [insertionReason, setInsertionReason] = useState("");

// 插入成功後：
const data = await res.json();
setInsertionReason(data.insertionReason);

// 顯示：
{insertionReason && (
  <p className="text-xs text-indigo-600 mt-2 bg-indigo-50 rounded px-2 py-1">
    💡 {insertionReason}
  </p>
)}
```

### 驗收標準

- [ ] `insertAfterDay` 在合法範圍 1 到 days.length-1
- [ ] AI 呼叫失敗時降級為對半切（不 throw）
- [ ] 前端插入後顯示 AI 理由說明
- [ ] 整體插入時間不超過原本顯著增加

---

## F5：多國連續插入購物車

### 目標

使用者可以先將多個推薦城市加入待選清單，透過迷你時間軸預覽確認天數分配後，一次批次套用至行程。

**期望 UI：**
```
待選清單
────────────────────────────────
☰  🇭🇺 布達佩斯      [2] 天  [移除]
☰  🇸🇰 布拉提斯拉瓦   [1] 天  [移除]

迷你時間軸預覽
────────────────────────────────
總天數：10 天 ✅（上限 12 天）

🟦 維也納        3 天  ⚠️ 縮減
🟩 布達佩斯       2 天  ✨ 新增
🟨 布拉提斯拉瓦    1 天  ✨ 新增
🟦 布拉格         4 天  ⚠️ 縮減

         [一次套用至行程 →]
```

### 影響檔案

| 檔案 | 狀態 |
|---|---|
| `src/components/WaypointCart.tsx` | ✨ 新增 |
| `src/app/api/v1/itinerary/[id]/batch-insert-waypoints/route.ts` | ✨ 新增 |
| `src/components/TransitRecommendationsPanel.tsx` | 修改 |
| `src/components/TransitRecommendationCard.tsx` | 修改 |
| `src/components/ViewContent.tsx` | 修改 |
| `src/types/itinerary.ts` | 修改（新增型別） |

### 新增型別

```typescript
// src/types/itinerary.ts 補充
interface CartItem {
  recommendation: TransitRecommendation;
  stayDays: number;
  order: number;
}

interface MiniTimelineDay {
  city: string;
  days: number;
  isReduced: boolean;
  isNew: boolean;
  isOverLimit: boolean;
}

interface BatchInsertRequest {
  items: CartItem[];
}

interface BatchInsertResponse {
  itinerary: Itinerary;
  insertionReasons: Record<string, string>;
}
```

### 實作步驟

**Step 1 — ViewContent.tsx：新增 cartItems state**

```typescript
const [cartItems, setCartItems] = useState<CartItem[]>([]);

const handleAddToCart = (recommendation: TransitRecommendation) => {
  if (cartItems.some(item => item.recommendation.name === recommendation.name)) return;
  setCartItems(prev => [
    ...prev,
    { recommendation, stayDays: recommendation.stayDays ?? 2, order: prev.length },
  ]);
};

const handleRemoveFromCart = (name: string) => {
  setCartItems(prev => prev.filter(item => item.recommendation.name !== name));
};
```

**Step 2 — TransitRecommendationCard.tsx：改為加入待選**

```tsx
// 移除直接插入邏輯，改為 callback
<button onClick={() => onAddToCart(recommendation)}>
  ＋ 加入待選清單
</button>
```

**Step 3 — WaypointCart.tsx：購物車元件職責**

- 列出 `cartItems`，每項可 +/- 調整 `stayDays`
- 使用 `@dnd-kit` 支援拖曳排序
- 即時呼叫 `computeMiniTimeline()` 計算並渲染迷你時間軸
- 超出總天數上限顯示紅色警告、禁止送出
- 「一次套用至行程」送出 batch API

```typescript
function computeMiniTimeline(
  originalDays: Day[],
  cartItems: CartItem[],
  maxDays: number
): MiniTimelineDay[]
// 計算各城市縮減後天數，標記 isReduced / isNew / isOverLimit
```

**Step 4 — batch-insert-waypoints API route 流程**

```
POST /api/v1/itinerary/[id]/batch-insert-waypoints
Body: { items: CartItem[] }

1. 依 CartItem.order 排序
2. 對每個 item 呼叫 findOptimalInsertionDay（平行化）
3. 依插入順序依序插入（每次插入後更新 days）
4. 若超出 maxDays 按比例縮減
5. 一次寫入 DB
6. 回傳完整 itinerary + insertionReasons
```

### 驗收標準

- [ ] 購物車最多同時加入 4 個城市
- [ ] 超出天數上限時有紅色警告，禁止送出
- [ ] 拖曳排序後迷你時間軸即時更新
- [ ] 批次插入後行程天數正確無重複
- [ ] 購物車清空後推薦面板恢復正常

---

## 技術注意事項

### AI 呼叫成本控制

- F4 的 `findOptimalInsertionDay` 限制 `max_tokens: 100`
- F5 的批次插入用 `Promise.all` 平行化 `generateDayStops()`，避免依序等待
- 所有新增 AI 呼叫都有 try/catch，失敗時降級為規則式邏輯

### 錯誤邊界

- F1：移動日 prompt 失敗時補上預設交通 stop，確保移動日不為空
- F5：批次插入中途失敗時回傳已成功項目清單 + 失敗項目，不全部回滾

---

## 分支與交付建議

```
feat/fill-the-gaps          ← F1 + F2（移動日優化 + 交通 CTA，最快交付）
feat/graceful-degradation   ← F3（獨立 UI 改動，可平行進行）
feat/smart-insertion        ← F4（AI 時間點，依賴 F1 的 insert-waypoint 修改）
feat/waypoint-cart          ← F5（購物車，最複雜，建議最後）
```

每個分支完成後合回 `main`，確保功能不互相阻塞。

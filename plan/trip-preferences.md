# 旅程偏好設定功能實作計畫

## 功能概述

讓使用者在產生行程前，可以設定：
- **步調與節奏**：悠閒 / 適中 / 緊湊
- **預算區間**：經濟實惠 / 中等消費 / 高端奢華
- **特殊偏好**：美食、文化歷史、自然景觀、購物、冒險戶外（可複選）

這些設定會注入到 AI prompt，影響生成的行程內容。

---

## 資料設計

### 新增欄位（存放於 `Itinerary.config` JSON，無需 DB migration）

```ts
type TripPreferences = {
  pace: "relaxed" | "moderate" | "intensive";
  budget: "budget" | "moderate" | "luxury";
  interests: Array<"food" | "culture" | "nature" | "shopping" | "adventure">;
};
```

### API 請求 body 新增欄位

```ts
{
  prompt: string;
  days: number;
  userId?: string;
  preferences?: TripPreferences;
}
```

---

## 實作步驟

### Step 1 — 更新 Zod Schema

**檔案：** `src/lib/schemas.ts`

新增 `TripPreferencesSchema`，並加入 `GenerateRequestSchema`：

```ts
export const TripPreferencesSchema = z.object({
  pace: z.enum(["relaxed", "moderate", "intensive"]).optional(),
  budget: z.enum(["budget", "moderate", "luxury"]).optional(),
  interests: z
    .array(z.enum(["food", "culture", "nature", "shopping", "adventure"]))
    .optional(),
});

// 在 GenerateRequestSchema 加入：
preferences: TripPreferencesSchema.optional(),
```

---

### Step 2 — 更新 AI Prompt

**檔案：** `src/app/api/v1/generate-stream/route.ts`
**檔案：** `src/app/api/v1/generate/route.ts`

將偏好轉為中文描述並注入 system prompt：

```ts
const paceMap = {
  relaxed: "悠閒，每天景點不超過 3 個，留有充足休息時間",
  moderate: "適中，每天安排 3-4 個景點",
  intensive: "緊湊，每天安排 5 個以上景點，行程滿檔",
};

const budgetMap = {
  budget: "經濟實惠，偏好免費或低消費景點、平價餐廳",
  moderate: "中等消費，一般觀光景點與餐廳",
  luxury: "高端奢華，頂級餐廳、精品購物、私人導覽",
};

const interestMap = {
  food: "美食",
  culture: "文化歷史",
  nature: "自然景觀",
  shopping: "購物",
  adventure: "冒險戶外活動",
};

// 組合成 prompt 附加文字
let preferencePrompt = "";
if (preferences) {
  if (preferences.pace) preferencePrompt += `\n行程步調：${paceMap[preferences.pace]}。`;
  if (preferences.budget) preferencePrompt += `\n預算級別：${budgetMap[preferences.budget]}。`;
  if (preferences.interests?.length) {
    const labels = preferences.interests.map((i) => interestMap[i]).join("、");
    preferencePrompt += `\n旅遊偏好：以${labels}為主。`;
  }
}

// 注入 system prompt
`你是專業的旅遊規劃專家。Always respond in Traditional Chinese (繁體中文).${preferencePrompt}`
```

---

### Step 3 — 更新 Hook

**檔案：** `src/hooks/useStreamingGenerate.ts`

`generate()` 函式新增 `preferences` 參數，並帶入 fetch body：

```ts
async function generate(
  prompt: string,
  days: number,
  preferences?: TripPreferences
) { ... }
```

---

### Step 4 — 更新首頁 UI

**檔案：** `src/app/page.tsx`

在原本的 `prompt` + `days` 表單下方新增偏好設定區塊：

#### 步調與節奏（單選，三個按鈕）
```
[ 悠閒 ]  [ 適中 ]  [ 緊湊 ]
```

#### 預算區間（單選，三個按鈕）
```
[ 經濟實惠 ]  [ 中等消費 ]  [ 高端奢華 ]
```

#### 特殊偏好（多選，chip 樣式）
```
[美食] [文化歷史] [自然景觀] [購物] [冒險戶外]
```

UI 風格與現有 Tailwind 元件一致，選中狀態用 `ring` 或 `bg` 區分。

---

### Step 5 — 將偏好存入 config

**檔案：** `src/app/api/v1/generate-stream/route.ts`
**檔案：** `src/app/api/v1/generate/route.ts`

儲存 itinerary 時，將 preferences 寫入 config：

```ts
config: {
  generatedWith: prompt,
  totalDays: days,
  createdAt: new Date().toISOString(),
  isStreamed: true,
  preferences: preferences ?? null,
},
```

---

## 修改檔案一覽

| 檔案 | 修改類型 |
|------|----------|
| `src/lib/schemas.ts` | 新增 `TripPreferencesSchema`，擴充 `GenerateRequestSchema` |
| `src/hooks/useStreamingGenerate.ts` | `generate()` 新增 `preferences` 參數 |
| `src/app/api/v1/generate-stream/route.ts` | 接收 preferences，注入 prompt，存入 config |
| `src/app/api/v1/generate/route.ts` | 同上（非串流版本） |
| `src/app/page.tsx` | 新增偏好設定 UI |

---

## 不需要修改

- `prisma/schema.prisma`：config 已是 JSON 欄位，無需 migration
- Stop 相關 API：與偏好無關
- 地圖元件：與偏好無關

---

## 預期 AI Prompt 效果範例

**使用者輸入：** 東京 5 天，悠閒步調、高端奢華、美食 + 文化歷史

**System prompt 附加：**
```
行程步調：悠閒，每天景點不超過 3 個，留有充足休息時間。
預算級別：高端奢華，頂級餐廳、精品購物、私人導覽。
旅遊偏好：以美食、文化歷史為主。
```

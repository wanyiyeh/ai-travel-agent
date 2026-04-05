# Skill: 使用者偏好設定注入 AI Prompt

## 功能說明

讓使用者在生成行程前選擇步調、預算、特殊偏好，並將這些設定轉換為自然語言注入 AI prompt，影響生成結果。

---

## 修改檔案

| 檔案 | 修改內容 |
|------|----------|
| `src/lib/schemas.ts` | 新增 `TripPreferencesSchema` 與 `TripPreferences` 型別 |
| `src/app/page.tsx` | 新增步調、預算、偏好 UI 元件與對應 state |
| `src/hooks/useStreamingGenerate.ts` | `generate()` 加入 `preferences` 第三個參數 |
| `src/app/api/v1/generate-stream/route.ts` | 接收 preferences、注入 prompt、存入 config |
| `src/app/api/v1/generate/route.ts` | 同上（非串流版本） |

---

## 核心實作

### 1. Schema 定義 (`src/lib/schemas.ts`)

```ts
export const TripPreferencesSchema = z.object({
  pace: z.enum(["relaxed", "moderate", "intensive"]).optional(),
  budget: z.enum(["budget", "moderate", "luxury"]).optional(),
  interests: z
    .array(z.enum(["food", "culture", "nature", "shopping", "adventure"]))
    .optional(),
});

export type TripPreferences = z.infer<typeof TripPreferencesSchema>;
```

- 三個欄位皆為 optional，使用者不選也能送出
- 用 `z.infer` 自動產生 TypeScript 型別，前後端共用

---

### 2. UI State 管理 (`src/app/page.tsx`)

**單選（步調、預算）：**
```ts
const [pace, setPace] = useState<TripPreferences["pace"]>(undefined);

// 再點一次取消選取
onClick={() => setPace(pace === opt.value ? undefined : opt.value)}
```

**多選（特殊偏好）：**
```ts
const [interests, setInterests] = useState<NonNullable<TripPreferences["interests"]>>([]);

function toggleInterest(val) {
  setInterests((prev) =>
    prev.includes(val) ? prev.filter((i) => i !== val) : [...prev, val]
  );
}
```

**送出時打包：**
```ts
const preferences: TripPreferences = {
  pace,
  budget,
  interests: interests.length ? interests : undefined,
};
await generate(prompt, days, preferences);
```

---

### 3. Hook 傳遞參數 (`src/hooks/useStreamingGenerate.ts`)

```ts
const generate = useCallback(async (
  prompt: string,
  days: number,
  preferences?: TripPreferences   // 新增第三個參數
) => {
  const response = await fetch("/api/v1/generate-stream", {
    body: JSON.stringify({ prompt, days, preferences }),
  });
```

---

### 4. 後端 Prompt 注入 (`generate-stream/route.ts`, `generate/route.ts`)

**對照表：**
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
  food: "美食", culture: "文化歷史", nature: "自然景觀",
  shopping: "購物", adventure: "冒險戶外活動",
};
```

**組合成 prompt 附加文字：**
```ts
function buildPreferencePrompt(preferences?: TripPreferences): string {
  if (!preferences) return "";
  const lines: string[] = [];
  if (preferences.pace) lines.push(`行程步調：${paceMap[preferences.pace]}。`);
  if (preferences.budget) lines.push(`預算級別：${budgetMap[preferences.budget]}。`);
  if (preferences.interests?.length) {
    const labels = preferences.interests.map((i) => interestMap[i]).join("、");
    lines.push(`旅遊偏好：以${labels}為主。`);
  }
  return lines.length ? "\n\n使用者偏好：\n" + lines.join("\n") : "";
}
```

**注入 system prompt：**
```ts
const systemPrompt = `你是專業的旅遊規劃專家。請為用戶規劃 ${days} 天的旅遊行程。${buildPreferencePrompt(preferences)}
...`
```

**存入 DB config：**
```ts
config: {
  generatedWith: prompt,
  totalDays: days,
  createdAt: new Date().toISOString(),
  isStreamed: true,
  preferences: preferences ?? null,  // 新增
},
```

---

## 資料流

```
使用者點選 UI 按鈕
  → React state (pace / budget / interests)
  → handleSubmit 打包成 preferences 物件
  → useStreamingGenerate.generate(prompt, days, preferences)
  → fetch POST body: { prompt, days, preferences }
  → API route: Zod 驗證 preferences 格式
  → buildPreferencePrompt() 轉成中文描述
  → 注入 OpenAI system prompt
  → AI 生成符合偏好的行程 JSON
  → 存進 Itinerary.config (preferences 欄位)
  → 回傳給前端，跳轉到 /view/:id
```

---

## 設計原則

- **全部 optional**：偏好不填也能正常使用，不破壞原有流程
- **前後端共用型別**：Zod schema 用 `z.infer` 匯出型別，不重複定義
- **無 DB migration**：偏好存在 `config` JSON 欄位，直接擴充
- **可讀性優先**：用對照表將 enum 值轉為中文，AI prompt 更自然

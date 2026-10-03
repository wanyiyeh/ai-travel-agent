# 首頁表單偏好接線修正計畫

> 狀態：草案，待確認「待決定事項」後開工
> 分支：`fix/form-preferences`（從 `test/form-fidelity` 合併後的 `main` 開）
> 背景：`docs/process.md` 2026-10-03 第 6 節；缺口已用 `it.fails` 釘在
> `src/lib/assembleItineraryDays.test.ts`、`src/lib/itineraryCityGen.pace.test.ts`

---

## 0. 範圍：只動演算法路徑

這次只修**規則引擎路徑**（`assembleItineraryDays` → `itineraryCityGen` 的
`*ViaScheduler` 函式），也就是現在生成行程的主路徑。

不動的部分：

- **舊的全 LLM 流程**（`generate-stream` 規則引擎失敗時的 fallback）：它已經把
  表單偏好（`buildPreferencePrompt`）和自由文字一起放進 prompt，交給 LLM 自行
  遵守，跟演算法無關。
- **景點挑選、排序、時間分配的演算法本身**（`selectAndOrderStops`、
  `assignTimeSlots` 等）：它們原本就支援 `pace`、`interestWeights`、
  `dayStartMinute`。問題是上游一直傳中性值進去，**不是演算法本身錯**。

換句話說，大部分修改是「把值傳進去」。只有每天景點數（第 2 步）會改到演算法的
參數。

---

## 1. 現況：資料怎麼流

```
表單 ──► preferences { pace, budget, interests, travelers }
     └─► prompt（自由文字 + 中途停留城市）
              │
              ▼
assembleItineraryDays
  ├─ planTrip(preferences, prompt)        ← 有用到：只決定城市與天數
  ├─ budget                               ← 有用到：景點價位、餐廳、住宿
  └─ preferenceIntent = NEUTRAL  ◄─── 問題在這裡：寫死中性值
        ├─ generateDayStops         → pace / interestBoost / startTime 都是空的
        ├─ generateTransitDayStops  → 同上
        └─ generateDepartureDayStops→ 同上
     generateMealsAndAccommodation  → 沒有飲食限制參數
```

`PreferenceIntent` 是排程演算法讀的偏好格式，目前只有兩個來源：

- `restructure/route.ts` 會呼叫 `parsePreferenceIntent(自由文字)`，但沒合併表單
  選的 pace／interests。
- `assembleItineraryDays` 完全不產生，直接用中性值。

---

## 2. 修改步驟

照順序做。每做完一步，就把對應的 `it.fails` 改回 `it`，`npm test` 要維持綠燈。

### 第 1 步：產生並合併 PreferenceIntent（解掉 3 個 it.fails）

**新增純函式** `mergePreferenceIntent(preferences, parsed)`，放在
`src/lib/preferenceIntent.ts`：

| 欄位 | 來源 | 規則 |
|---|---|---|
| `pace` | 表單優先，沒選才用自由文字解析的值 | 表單是使用者明確點選的 |
| `interestBoost` | 表單興趣轉成的標籤 ∪ 自由文字解析的標籤 | 取聯集、去重 |
| `startTimePreference` | 只來自自由文字 | 表單沒有這個欄位 |
| `dietaryRestrictions` | 只來自自由文字 | 同上 |
| `avoid` | 只來自自由文字 | 同上 |

表單興趣怎麼轉成標籤：`culture`、`nature`、`shopping` 直接沿用同名標籤，
`INTEREST_CATEGORY_BOOST` 已經有這三個。`food`、`adventure` 見第 4 步。

**`assembleItineraryDays`**：把第 66 行的 `NEUTRAL_PREFERENCE_INTENT` 改成：

```ts
const [plan, parsedIntent] = await Promise.all([
  planTrip(flightInfo, prompt, preferences, model),
  parsePreferenceIntent(prompt ?? "", model),
]);
const preferenceIntent = mergePreferenceIntent(preferences, parsedIntent);
```

和 `planTrip` 並行，所以不會多花等待時間。`parsePreferenceIntent` 本身不會丟錯，
失敗時回傳中性值，不會把生成弄壞。

**`restructure/route.ts`**：同樣改用 `mergePreferenceIntent(config.preferences, parsed)`，
讓「重新規劃行程」也吃得到表單的 pace／interests，兩邊行為一致。

**成本**：自由文字不是空的時候，每次生成多 1 次 gpt-4o-mini 小呼叫，約 US$0.0005。
勾選中途停留城市也算有自由文字，因為前端會把它接到 prompt 後面。Google 呼叫不變。

**測試**：`mergePreferenceIntent` 的單元測試，涵蓋表單優先、聯集、空值。
做完這步會解掉 `assembleItineraryDays.test.ts` 裡 pace、interests、自由文字這 3 個
`it.fails`。

### 第 2 步：步調決定每天景點數（解掉 2 個 it.fails）

這是唯一會改到演算法參數的一步。

- `itineraryCityGen.ts` 的 `STOPS_PER_DAY = 4` 改成依 pace 查表，對齊首頁表單的說明：
  `relaxed: 3`、`moderate: 4`、`intensive: 5`。
- 用在 `generateDayStopsViaScheduler` 的 `maxCount` 和 `distributeStopsPerDay`。
- 移動日、回程日不改：這兩種日子的景點數本來就由可用時間決定
  （`arrivalActivityCount`、`computeDepartureDayBudget`），pace 已經影響它們的
  緩衝時間。

**時間塞不塞得下**：5 個景點以最長的 museum 90 分鐘計算，加上 4 段 5 分鐘緩衝和
1 小時午餐，最多 530 分鐘，從 08:00 出發會在 16:50 結束，在 18:00 前。但如果
同時是「晚點出門」（10:00 開始）或抵達當天，就可能超過 18:00。觀光日目前**不會**
裁掉超時的景點，只有回程日會，所以這一步要加上同樣的處理：超過 `dayEndMinute`
的尾端景點就裁掉。

**已知限制：候選池上限 20 個**。Nearby Search 一次最多回 20 個景點，還要扣掉移動日
已經用掉的。舉例來說，緊湊步調在同一城市待 4 天需要 20 個，實際上每天會少於 5 個，
`distributeStopsPerDay` 會平均分配。這一步先接受這個限制，見待決定事項 C。

**Google 費用**：不變。Nearby 的快取鍵固定用 20 筆，`maxCount` 只是從快取結果裡切片。

### 第 3 步：飲食限制進到餐廳挑選（解掉 1 個 it.fails）

- `generateMealsAndAccommodation` 加一個選填參數 `dietaryRestrictions: string[] = []`。
  因為是選填，restructure 和其他既有呼叫端不用改也不會壞。
- 有限制時，在挑選餐廳的 prompt 規則裡加一行，例如「旅客飲食限制：no_seafood。
  請避開以此為主的店家（例如海鮮餐廳），候選不符合時寧可選其他候選」。
  `assembleItineraryDays` 和 restructure 都把合併後的 intent 傳進去。
- 這一步只靠 prompt，LLM 從真實候選裡挑，不會額外查 Google。效果是「降低機率」，
  不是保證，要靠第 6 步的付費評分量實際遵守率。

### 第 4 步：「美食」「冒險戶外」的興趣對應（需要你決定，見 A）

### 第 5 步：人數（需要你決定，見 B）

### 第 6 步：付費評分腳本（之後再做，跑之前會先跟你確認）

接線修好後，新增 `scripts/eval-form-fidelity.ts`，用真實 API 跑一組對照情境，
量 LLM 和演算法實際遵守的程度：

- 不同步調的每天平均景點數
- 不同預算的餐廳 `priceLevel`
- 興趣對應類別的佔比
- 中途停留城市有沒有出現
- 飲食限制關鍵字有沒有被違反

---

## 3. 待決定事項

**A. 「美食」「冒險戶外」要對應到什麼？**
景點候選池只查 `tourist_attraction`，沒有餐廳類，所以「美食」沒有東西可以加權。
選項如下：

1. 「美食」只影響餐廳：在第 3 步的同一段 prompt 加「優先在地特色、評價高的店」。
   「冒險戶外」對應到 `park`、`viewpoint`。**建議選這個，改動最小。**
2. 「美食」另外加一次 `market`／`food_court` 類的 Nearby 搜尋，把市場排進景點。
   每個城市多 1 次 Google 呼叫（30 天快取）。
3. 先不處理，表單維持原樣。

**B. 人數要做什麼？**
目前整個 `src/` 都沒有讀這個欄位。可以：

1. 預估花費乘上人數。
2. 住宿 prompt 提示房型。
3. 先從表單拿掉，避免使用者以為有作用。

**建議**：這次不做，另外開題。

**C. 緊湊步調在長天數城市不足 5 個景點，要不要擴充候選池？**
如果要，就是額外用 `museum`、`park` 這類 type 再查一次 Nearby，每個城市多 1 次
Google 呼叫。**建議**：先不做，等第 6 步量出實際影響再決定。

**D. 表單的 pace 和自由文字衝突時，哪個優先？**
例如表單選「悠閒」，文字卻寫「想排滿一點」。**建議**：表單優先，見第 1 步。
如果你覺得文字比較具體、應該由文字優先，跟我說。

---

## 4. 驗證方式

- 每一步：`npm test`，對應的 `it.fails` 改回 `it` 並通過，其他測試不退步。
- 全部做完後，用 `npm run dev:mock` 實際生成一趟行程，看三種步調的景點數和
  「不吃海鮮」的餐廳。Google 是假的，**但 OpenAI 是真的**，一次生成大約
  10–15 次 gpt-4o-mini 呼叫。跑之前會先跟你確認。
- 第 6 步的真實 API 評分另外確認。

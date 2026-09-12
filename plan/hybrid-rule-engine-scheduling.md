# 混合架構升級計畫：規則引擎排骨架 + LLM 寫文案／讀偏好

> 建立日期：2026-09-12
> 基準分支：`feat/itinerary-list`
> 動機：目前行程生成是「LLM 一次決定全部」（天數、順序、時段、時長、交通、文案全部由
> prompt 決定），穩定性完全綁在 LLM 的輸出品質上。本計畫規劃如何拆分成
> 「規則引擎排時段骨架」+「LLM 只負責風格化文案與自由文字偏好解析」的混合架構。

---

## 1. 現況分析

延續 [itinerary-generation-flow.md](itinerary-generation-flow.md) 的 Google → AI → Google
三段式，目前 **AI 那一段做的事情遠超過「寫文案」**：

| 職責 | 現況負責者 | 位置 |
|---|---|---|
| 天數／城市分配 | LLM | `buildSystemPrompt()`, `src/lib/itineraryGen.ts:58-181` |
| 每天景點/餐廳挑選與排序 | LLM（從 Places hints 清單挑，或自由發揮） | 同上 |
| `time_of_day`（早/中/晚） | LLM 決定，僅 `recalculate-transport` 重新計算時才用規則 | `recalculate-transport/route.ts:15-23`（`assignTimeOfDay`，純規則，thirds-split） |
| `duration_minutes`（停留時長） | LLM | 無規則版本 |
| 開放時間／營業時段檢查 | 無 | 完全沒有規則或 LLM 檢查 |
| 節奏／單日密度控制 | LLM（prompt 文字指示） | `buildSystemPrompt` rules 5,8,9,13（`itineraryGen.ts:160-177`） |
| 交通方式與敘述文字 | 規則（真實 Google 距離 + heuristic） | `distanceMatrix.ts:76-184`（`getDistance`/`pickModeForDistance`/`describeTransport`） |
| 費用估算 | 規則（price level 對照表） | `src/lib/priceLevelCost.ts` |
| 地理合理性檢查 | 規則（事後驗證，非事前排程） | `validateGeography.ts`, `nearestCity.ts` |
| 自由文字偏好 | 原樣塞進 prompt，無獨立解析 | `generate-stream/route.ts:118-120` |

**結論**：現有系統已經有「規則引擎的雛形」——`recalculate-transport` 的
`assignTimeOfDay` + 真實距離換算，就是本計畫要擴大的核心。但**排序、配對、節奏、開放時間**
這些骨架決策目前完全交給 LLM 用文字規則「盡量遵守」，這正是不穩定的來源
（幻覺地點、時段矛盾、單日過度緊湊或稀疏）。

---

## 2. 目標架構

```
使用者輸入（結構化偏好 + 自由文字）
        │
        ▼
┌─────────────────────────┐
│ LLM：偏好解析層           │  自由文字 → 結構化 PreferenceIntent
│ （小、單一職責的呼叫）     │  例：「想放鬆一點、晚點出門、想吃在地小吃」
└─────────────────────────┘  → { pace: "relaxed", startTimePreference: "late",
        │                        interestBoost: ["local_food"] }
        ▼
┌─────────────────────────┐
│ Google Places           │  候選池（沿用現有 fetchCityRestaurants /
│ （候選池，不變）          │  fetchCityAttractions / 快取層）
└─────────────────────────┘
        │
        ▼
┌─────────────────────────┐
│ 規則引擎：骨架排程        │  純函式、可測試、無 LLM 呼叫：
│（新模組，本計畫核心）      │  - 城市/天數配置（沿用 restructure 的城市分塊邏輯）
│                          │  - 從候選池挑選＋排序（距離最短路徑貪婪法或簡單 TSP heuristic）
│                          │  - time_of_day／duration 分配（擴充 assignTimeOfDay）
│                          │  - 節奏／密度控制（依 pace 設定每日站點數上限）
│                          │  - 用餐時段插入（早7-9/午12-14/晚18-20 固定窗口 + 就近候選）
│                          │  - 交通方式與時間（沿用 distanceMatrix.ts，不變）
│                          │  - 開放時間過濾（新：若候選有 opening_hours 就排除衝突時段）
└─────────────────────────┘
        │  輸出：確定的 Day[]/Stop[] 骨架（時間、順序、地點皆已確定，
        │        stop 只有 placeId/name，尚無文案）
        ▼
┌─────────────────────────┐
│ LLM：風格化文案層         │  輸入：已排好的骨架 + 使用者風格偏好
│（小、單一職責的呼叫）     │  輸出：僅補文字欄位（描述、亮點、transport_from_prev 的
│                          │  自然語言敘述、每日主題句），不可更動時間/順序/地點
└─────────────────────────┘
        │
        ▼
      存檔
```

**關鍵原則**：規則引擎輸出的骨架是「唯一真相」，LLM 文案層**只能填文字欄位**，
不得回傳可能改動結構的欄位（用 Zod schema 直接把 stop 順序、時間、placeId
設成唯讀/不接受 LLM 輸出即可從根本杜絕幻覺覆蓋骨架）。

---

## 3. 規則引擎要涵蓋的模組（新增）

建議放在 `src/lib/scheduler/` 底下，每個都是純函式、獨立可單元測試：

1. **`assignCityBlocks.ts`**——天數/城市分配。可直接把 `restructure/route.ts` 裡
   「依地理插入城市」的邏輯抽出來，去掉對 `itineraryCityGen.ts` LLM 呼叫的依賴。
2. **`selectAndOrderStops.ts`**——從 Places 候選池挑選＋排序。
   初版可用簡單策略：貪婪最近鄰（nearest-neighbor）依 `interests` 權重挑選、
   按地理位置排序成一條可走的路線；不必一開始就上真正的 TSP solver。
3. **`assignTimeSlots.ts`**——擴充現有 `assignTimeOfDay`：
   - 加入固定用餐窗口（早餐/午餐/晚餐時段），非用餐 stop 依 `duration_minutes`
     估計值（可先用「景點類型 → 預設停留時長」對照表，如
     `museum: 90min, viewpoint: 30min, temple: 45min`）累加排入剩餘時段。
   - 加入 pace 參數：`relaxed`（每日站點少、時段間留緩衝）、`packed`（反之）。
4. **`filterByOpeningHours.ts`**——若 Places 候選帶 `opening_hours`
   （目前 hints 查詢刻意只要 `displayName`/`rating`，需要評估要不要多查這欄位，
   有 API 成本考量，見第5節風險）就排除當天時段不開的候選。
5. **`assignTransport.ts`**——沿用不動，`distanceMatrix.ts` 已經是規則引擎的一部分。
6. **`estimateCost.ts`**——沿用不動，`priceLevelCost.ts` 已經是規則引擎的一部分。

---

## 4. LLM 保留的兩個職責

### 4a. 自由文字偏好解析（新增，獨立呼叫）
- 輸入：使用者 `prompt` 自由文字欄位。
- 輸出：結構化 `PreferenceIntent`（Zod schema 定義，例如 pace 傾向、興趣加權、
  時間偏好、飲食限制、避免事項），**用小 prompt + `response_format: json_object`
  + 嚴格 Zod 驗證**，失敗就 fallback 成中性預設值（不重試整趟生成，只重試這一小步）。
- 這一步比現在「整段自由文字塞進大 prompt」更容易測試與除錯：可以針對這個小函式
  寫單元測試（給定幾句常見自由文字，斷言解析出的 intent 欄位）。

### 4b. 風格化文案生成（收斂現有大 prompt）
- 輸入：規則引擎排好的骨架（已含地點、時間、順序、交通方式）+ `PreferenceIntent`。
- 輸出：**只有文字欄位**——每個 stop 的描述/亮點一句話、每天的主題句、
  `transport_from_prev` 的自然語言敘述（現在 `describeTransport()` 已經是規則生成的
  中文敘述，可視需求保留規則版本或讓 LLM 潤飾，但潤飾結果仍需驗證不含時間/地點資訊被竄改）。
- Schema 設計成「LLM 只能回傳 `Record<stopId, {description, highlight}>` 這種
  keyed-by-id 的文字 map」，而不是回傳整個 Day/Stop 物件——這樣即使 LLM
  幻覺出多餘欄位，合併時直接忽略，結構不可能被污染。

---

## 5. 分階段執行計畫

不建議一次重寫（風險太高，且會動到 `generate-stream`、`itineraryCityGen`、
`recalculate-transport` 三條現有路徑）。建議按以下順序，每階段都可獨立上線、
獨立驗證：

### Phase 0：地基（不改變任何使用者可見行為）
- 把 `recalculate-transport/route.ts` 裡的 `assignTimeOfDay` 抽成
  `src/lib/scheduler/assignTimeSlots.ts` 的獨立函式，加單元測試。
  這一步純重構，先確認抽出來的規則引擎雛形沒有回歸。

### Phase 1：偏好解析層先落地（風險最低，價值可獨立驗證）
- 新增 `parsePreferenceIntent()`，先只在 UI 上顯示「解析結果預覽」給使用者確認
  （或先只記錄 log 比對「LLM 解析出的 intent」vs「現在塞進大 prompt 的原始文字」
  兩種模式的生成結果差異），不急著馬上取代現有流程。

### Phase 2：規則引擎排序 + 現有 LLM 大 prompt 並行（影子模式）
- 對同一批候選池，同時跑「LLM 整段生成」和「規則引擎排骨架」，
  比較兩者輸出的 stop 順序、時段分配差異，人工抽樣檢查規則引擎排出來的
  骨架是否合理（尤其節奏、用餐時段）。這一步**不影響正式使用者流程**，
  只在開發/測試環境跑，用來校準規則引擎的參數（如預設停留時長對照表）。

### Phase 3：單城市/單日試點
- 選最簡單的情境（單城市、非跨國、非 transit day）先切到「規則引擎排骨架
  + LLM 只補文案」，其餘情境（多城市、transit day）暫時維持舊流程。
  這對應 `itineraryCityGen.ts` 裡最簡單的 `generateDayStops` 情境。

### Phase 4：擴大到多城市/transit day
- 把 `assignCityBlocks.ts` 接上 restructure 的城市分塊邏輯，
  逐步取代 `itineraryCityGen.ts` 三個 LLM 呼叫中「決定骨架」的部分，
  只保留文案生成呼叫。

### Phase 5：收斂 `generate-stream` 主流程
- 最後才動最關鍵的整段生成路徑，因為使用者體感最直接。
  串流體驗需要重新設計：規則引擎是同步且快的，可以先秒級回傳骨架，
  文案生成才需要串流「逐步補文字」的體驗（比現在「逐字打出結構化 JSON」
  更適合串流，因為文字內容本來就適合漸進顯示）。

### Phase 6：清理
- 確認新流程穩定後，移除 `itineraryCityGen.ts` 裡舊的整段生成呼叫、
  簡化 `buildSystemPrompt()`（現在 100+ 行的規則文字大多可以刪除，
  因為那些規則已經變成真正的程式碼規則，不再需要「拜託 LLM 遵守」）。

---

## 6. 資料模型變動

- `PreferenceIntent` 新型別（`src/types/` 下新增），Zod schema 對應。
- Stop/Day 型別（`src/types/itinerary.ts`）需要新增規則引擎產出但目前沒有的欄位：
  - `estimatedDurationMinutes`（目前只有 LLM 給的 `duration_minutes`，語意上要
    區分「規則引擎的預設估計值」與「後續可能被使用者手動覆蓋的值」）。
  - 若要做開放時間過濾，Stop candidate 需要保留 `opening_hours`
    （目前 `fetchCityRestaurants.ts` 的 hints 查詢故意不查這欄位以節省 API 成本，
    見第7節風險）。
- 文案生成 LLM 呼叫的輸出 schema 改成 keyed-by-id 的純文字 map，
  與骨架資料結構解耦。

---

## 7. 風險與待確認事項

- **開放時間資料成本**：目前 hints 查詢刻意省略 `opening_hours` 欄位以降低
  Google Places API 呼叫成本（見 `google-api-cost-spike-2026-07.md` 的教訓）。
  若要做真正的開放時間過濾，需要評估：只在候選池「已入選骨架」後才補查
  （呼叫量從「每城市15-20筆全查」降到「每天實際選中的5-8筆才查」），
  避免重蹈 API 成本暴增的覆轍。
- **排序演算法品質**：貪婪最近鄰排序可能不是最優路線，初版先求「不繞遠路」
  而非「全域最短路徑」，避免過度工程化。
- **LLM 文案品質下降風險**：現有大 prompt 裡「風格化描述」是跟著完整上下文
  （其他天、其他景點）一起生成的，拆成 keyed-by-id 小段落生成後，
  文案的前後呼應（例如避免用詞重複、整趟行程語氣一致）可能變差，
  需要在文案 prompt 裡塞入「整趟行程摘要」當上下文彌補。
- **測試策略**：規則引擎模組因為是純函式，應該用一般單元測試
  （沿用專案既有的 `tests/` 慣例）覆蓋邊界案例（單站點、超多站點、
  跨午夜、無候選可選等），這是現有 LLM-only 架構完全做不到的測試覆蓋率提升，
  也是這次重構最大的穩定性收益。

---

## 8. 每階段驗收標準

| 階段 | 驗收方式 |
|---|---|
| Phase 0 | 抽出的 `assignTimeSlots` 單元測試通過，`recalculate-transport` 行為零回歸 |
| Phase 1 | `parsePreferenceIntent` 對 10-20 組常見自由文字輸入的解析結果人工抽查合理 |
| Phase 2 | 影子模式跑 N 筆歷史行程，規則引擎骨架與 LLM 骨架的節奏/時段分布無明顯劣化 |
| Phase 3 | 單城市試點行程使用者體感（人工測試）不劣於現有版本，且生成時間更快/更穩定 |
| Phase 4 | 多城市/transit day 情境覆蓋，`validateItinerary` 錯誤率下降 |
| Phase 5 | `generate-stream` 全量切換後，端對端測試（`tests/`）通過，錯誤重試次數（`MAX_GENERATION_ATTEMPTS`）統計下降 |
| Phase 6 | `buildSystemPrompt()` 行數大幅縮減，舊骨架生成路徑程式碼移除 |

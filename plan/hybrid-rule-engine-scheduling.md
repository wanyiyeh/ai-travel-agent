# 混合架構升級計畫：規則引擎排骨架 + LLM 寫文案／讀偏好

> 建立日期：2026-09-12
> 基準分支：`feat/itinerary-list`
> 動機：目前行程生成是「LLM 一次決定全部」（天數、順序、時段、時長、交通、文案全部由
> prompt 決定），穩定性完全綁在 LLM 的輸出品質上。本計畫規劃如何拆分成
> 「規則引擎排時段骨架」+「LLM 只負責風格化文案與自由文字偏好解析」的混合架構。

## 0. 進度追蹤

| 階段 | 狀態 | 備註 |
|---|---|---|
| Phase 0 | ✅ 完成 | `assignTimeOfDay` 抽到 `src/lib/scheduler/assignTimeSlots.ts`，`recalculate-transport` 已接上，單元測試通過 |
| 3.1-3.3 規則引擎積木 | ✅ 完成（未接上任何路由） | `assignCityBlocks.ts`（實作為 `planCityBlocks`）、`selectAndOrderStops.ts`、`assignTimeSlots.ts`（duration/pace/meal window 版）、`buildDaySkeleton.ts`（組裝前三者）皆為純函式，各自有單元測試 |
| Phase 1 | ✅ 驗收標準已完成 | `scripts/validate-preference-intent.ts`（`npm run validate-preference-intent`）對 18 組常見自由文字（單一/多重訊號、中性、矛盾、英文、邊界案例）跑真實 `parsePreferenceIntent()` 並人工抽查。**過程中抓到一個真的 bug**：「不吃辣」有約 60% 機率被誤解析成 `no_seafood`（因為 prompt 的 dietaryRestrictions 範例清單沒有辣度相關標籤，模型會套用最接近的範例），已在 `SYSTEM_PROMPT` 加入 `no_spicy`/`no_beef` 範例並明確要求「標籤要對應使用者實際說的限制，不要套用最接近的範例」，修復後重跑 6 次皆正確。其餘 17 組結果人工檢查合理 |
| Phase 2 | 🟡 骨架比對已有數據，時長估計已擱置 | `scripts/shadow-compare-scheduler.ts`（`npm run shadow-compare`，`--verbose` 看逐天明細）讀種子行程資料庫比對順序/時段：42 個可比較天數，順序完全相同 36%、平均每站位置差 0.64、`time_of_day` 一致率 43%。時長估計追查了兩層：(1) 用 `scripts/backfill-place-types.ts` + `mapPlaceTypeToCategory.ts` 補真實 Place type（108 站中 83 站對照到），但平均時長差不減反增（63→67 分鐘）；(2) 用 `scripts/calibrate-duration-table.ts` 想拿真實 `duration_minutes` 校準對照表，結果發現 LLM 本身 53% 的時候不分類型一律給 120 分鐘——**LLM 的 duration_minutes 不是可信的「依類型估時長」ground truth，往它校準沒有意義**。決定：維持現有 placeholder 對照表，時長估計標記為近似值、非這次重構的賣點，先往下推進其他階段（詳見第7節） |
| Phase 3 | 🟡 已接進真實路由，還缺真人 UI 測試 | `generateDayStops()` 已改走規則引擎骨架（PR #11），budget/`PreferenceIntent` 也接上了（見 0.2 節）。剩下「單城市試點」驗收標準裡唯一沒做的是真人在 UI 上走一次「重新規劃行程」精靈——目前只有腳本層級的真實 API 驗證，沒有瀏覽器端到端測試 |
| Phase 4-6 | ⬜ 未開始 | 多城市/transit day 擴大、收斂 `generate-stream` 主流程、清理舊路徑，見第5節 |

### 0.1 Phase 3 進度細節

1. **候選池補座標/類別**（`fetchCityRestaurants.ts`）：`RestaurantHint` 原本只有
   `{name, rating?}`，擴充 `searchNearbyHints()` 的 field mask 加入
   `places.location`/`places.types`，新增可選的 `lat`/`lng`/`types` 欄位（不影響
   現有只讀 name/rating 的 prompt-building 呼叫端）。**持續性小額外成本**：以後
   每次正式生成都多拉這兩個欄位，不是一次性費用。`CityPlaceHintsCache` 現有快取
   列（30 天 TTL）到期前仍是舊格式，不強制清快取。
2. **hint → candidate adapter**：新增 `src/lib/scheduler/hintsToStopCandidates.ts`，
   把 `RestaurantHint[]` 轉成 `buildDaySkeleton` 吃的 `StopCandidate[]`（濾掉沒
   座標的、用 `mapPlaceTypeToCategory` 算 type），回傳 `hintById` 供查回地點名稱。
3. **LLM 只補文案（第4b節）**：新增 `SkeletonCopySchema`（`src/lib/schemas.ts`）
   ——輸出限定 `{dayTheme?, stops: Record<stopId, {description, highlight?}>}`，
   沒有時間/順序/地點欄位，模型幻覺多餘 id/欄位也污染不到骨架。新增
   `src/lib/skeletonCopy.ts` 的 `generateSkeletonCopy()`：跟 `parsePreferenceIntent`
   同設計哲學，保證回傳涵蓋骨架裡每一個 stop id，模型漏掉的/呼叫失敗的各自
   fallback 成通用文字，不拖垮整天。`transport_from_prev` 刻意沿用規則版
   `describeTransport()`，沒有交給 LLM。
4. **多天候選池分配**：規劃實際接線時發現卡點比預期大——(a)
   `itineraryCityGen.ts` 的 `generateDayStops`（計畫指出的「最簡單情境」）目前
   完全是純 LLM 憑空生成，從沒呼叫過 `fetchCityRestaurants.ts`；(b)
   `restructure/route.ts` 的 `CitySchema` 只有城市名稱字串，一開始以為需要 IATA
   code 才能查候選池；(c) budget/`PreferenceIntent` 都還沒接進這條路徑。先解決
   跟這三個卡點無關、可以獨立完成的一塊：新增
   `src/lib/scheduler/partitionCandidatesByDay.ts` 的 `partitionCandidatesByDay()`
   ——把一個城市的候選池切成 N 天份、互不重複，每天用目前剩餘候選裡分數最高的
   當種子（讓好地點分散到不同天），其餘用離種子最近的候選填滿（同一天地理上
   聚在一起）。已從 `selectAndOrderStops.ts` 匯出 `scoreCandidate` 供其重用同一
   套評分邏輯。
5. **座標卡點其實不需要 IATA**：重新查證發現 `placesTextSearch.ts` 已有
   `getCityCenter(cityName, apiKey)`——用 Text Search 把任意城市名稱解析成座標
   並快取，不需要 IATA code，`restructure/route.ts` 的 `CitySchema.name` 直接可
   用，完全不用碰前端/schema。連帶決定候選池改走座標索引快取的
   `fetchNearbyPlaceCandidates`（本來就有 `placeId`/`address`/`photoName`，比
   `RestaurantHint` 更適合這裡），已比照第1點的做法幫它的 field mask 加上
   `places.types`，`PlaceCandidate` 新增可選 `types` 欄位。用真實京都資料端到端
   測過（`getCityCenter("京都")` → `fetchNearbyPlaceCandidates` → 真實 placeId +
   types），完全沒經過任何 IATA 查詢。（第1、2點擴充的 `RestaurantHint`
   沒有白做——主流程 `generate-stream` 用 IATA 機場代號，還是會用到。）

6. **PlaceCandidate → StopCandidate adapter**：新增
   `src/lib/scheduler/placeCandidatesToStopCandidates.ts`——比照
   `hintsToStopCandidates.ts`，但這次候選一定有座標（`fetchNearbyPlaceCandidatesUncached`
   本身就過濾掉沒 placeId 的結果），不需要濾掉缺座標的候選，直接用真實
   `placeId` 當 id（比 hint 版合成的 index-based id 更有意義，之後蓋真正的
   Stop 可以直接沿用）。用真實京都資料把**整條鏈**從頭到尾串起來測過一次：
   `getCityCenter("京都")` → `fetchNearbyPlaceCandidates` → adapter →
   `partitionCandidatesByDay`（分 2 天）→ 各自 `buildDaySkeleton` →
   `generateSkeletonCopy`——兩天的景點都正確落在各自地理區域（例如
   Day 1 清水寺/產寧坂/二寧坂全在東山區域，走路可達），文案自然、無幻覺。
   規則引擎積木 + 候選池 + 文案層至此全部就緒，且是第一次完整跑過一遍
   （不是分段測），沒有任何一段是空想的。

**還沒做的（更新後只剩一項）**：真實 UI 測試——其餘兩項見下方 0.2 節。

### 0.2 generateDayStops 接線 + budget/PreferenceIntent（已完成）

7. **`generateDayStops()` 換引擎，簽章不變**（PR #11，分支
   `feat/scheduler-daystops-generation`）：原本純 LLM 的實作改名
   `generateDayStopsWithLLM`（private, fallback 用），匯出的
   `generateDayStops()` 先試新的 `generateDayStopsViaScheduler()`——串起
   `getCityCenter` → `fetchNearbyPlaceCandidates` → `placeCandidatesToStopCandidates`
   → `partitionCandidatesByDay` → `buildDaySkeleton` → `generateSkeletonCopy`，
   再用 `distanceMatrix.ts` 的 `getDistancesForStopPairs`/`describeTransport`
   算 `transport_from_prev`、`priceLevelCost.ts` 的 `estimateAttractionCost` 算
   `estimated_cost`。任何一步失敗（拿不到城市座標、候選池空）就整個城市
   fallback 回 `generateDayStopsWithLLM`，`restructure/route.ts` 呼叫端完全沒改
   （只多傳一個 `lockedPlaceIds` 去重鎖定景點）。用真實京都資料跑過一次
   （`generateDayStops("京都", 2, "TWD")`），兩天都成功走新引擎，地點真實、
   文案無幻覺。
8. **budget/`PreferenceIntent` 接進 `restructure/route.ts`**（分支
   `feat/preference-intent-restructure`）：探索後發現這個 app 其實有兩套分離的
   偏好資料——`config.preferences`（表單選的結構化 `TripPreferences`，嚴格
   enum）和 `config.generatedWith`（自由文字，要重新呼叫
   `parsePreferenceIntent()` 才能解析）。這次接的是後者（plan 待辦原文指名
   「PreferenceIntent」）：`POST` 一開始從 `config.preferences.budget` 讀預算、
   對 `config.generatedWith` 跑一次 `parsePreferenceIntent()`（整趟行程只算
   一次，不分城市），往下傳給 `generateDayStops()` 新增的 `budget`/
   `preferenceIntent` 參數。`budget` → `getPriceLevels()` 篩候選池（沿用
   accommodation/meals regenerate 既有的「空結果就重試不篩價位」模式）；
   `pace`/`startTimePreference` 直接餵給 `buildDaySkeleton`；`interestBoost`
   （自由標籤，非 enum）加一個小範圍對照表映射到 `DurationCategory` 權重，
   對照不到的標籤（含 LLM 自己發明的）就是不加權，不會出錯；`avoid`/
   `dietaryRestrictions` 沒接候選篩選邏輯，但透過 `generateSkeletonCopy` 改吃
   真正的 `preferenceIntent`（不再寫死 `NEUTRAL_PREFERENCE_INTENT`）自動反映在
   文案語氣裡。**已知限制**：`TripPreferences.pace`/`interests`（表單那一套）
   刻意不接，避免跟 `PreferenceIntent.pace` 打架。用真實京都資料對照「中性
   參數」vs「luxury + relaxed + late + art/history」兩組呼叫：`pace`/
   `startTimePreference` 效果明顯（時段從全部 morning 變成部分 afternoon）；
   但 `budget`/`interestBoost` 這次沒看出候選被換掉——京都熱門景點池子小、
   多數廟宇/市場沒有 Google `priceLevel` 標籤，價位篩選十之八九觸發空結果
   fallback，資料特性使然，不是接線的 bug。

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
- **`DEFAULT_DURATION_BY_TYPE` 對照表未校準**（Phase 2 影子模式已釐清，原本
  誤判為「缺 type 資料」的問題）：一開始懷疑時長估計不準是因為候選池沒有
  Google Places 的 `types`，於是用 `scripts/backfill-place-types.ts` 對已入選
  stop 補查（57 筆、一次性、只補已選中的地點，成本可控，做法呼應上一條開放
  時間風險的建議），並新增 `mapPlaceTypeToCategory.ts` 把真實 `types` 對回
  六個估時分類。結果：108 站裡 83 站補到真實 type，但平均時長差不減反增
  （63→67 分鐘）。**真正原因是對照表本身的數字沒有依據**（museum:90/
  temple:45/... 是計畫階段隨手訂的預設值，從沒拿真實資料校準過）。之後若要
  真的用規則引擎估時長，要做的是拿這批已有真實時長的種子資料（`duration_minutes`
  vs 真實 `type`）重新統計校準對照表，而不是再花 API 成本查更多欄位。

  **接著實際跑了校準（`scripts/calibrate-duration-table.ts`），結果推翻了這個
  方向**：museum/temple/park/landmark 四個類別的中位數幾乎都收斂在同一個數字
  （120 分鐘），追查後發現整個資料庫（154 個非 transit day 的 stop）裡
  **LLM 有 53% 的機率不管景點類型一律給 120 分鐘**（其餘集中在 90/180/60 分鐘
  幾個整數值上）。也就是說 LLM 給的 `duration_minutes` 本來就不是真的依景點
  類型決定的，不是能拿來校準「依類型估時長」表的可信 ground truth——往 LLM
  輸出對齊，學到的只是「LLM 也沒在分類型」，不會讓表更準。真的要有意義的估時，
  需要真實世界的類別停留時長資料（例如公開的平均參觀時長統計），不是這個種子
  資料庫能提供的。**這改變了 Phase 3 的範圍界定：規則引擎的時長估計在有更好的
  外部資料源之前應視為「近似值」，不該被當成比 LLM 更準的賣點來推銷這次重構**。
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

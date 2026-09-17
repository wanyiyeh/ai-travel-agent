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
| Phase 4 | 🟡 transit day 已接進真實路由，範圍跟原計畫不同 | 原計畫寫的是「把 `assignCityBlocks.ts` 接上 restructure 城市分塊邏輯」，探索後發現風險高、價值低（見 0.3 節），改成「把 `generateTransitDayStops` 的到達景點換成規則引擎，交通方式/距離判斷仍交給 LLM」（PR #13）。`assignCityBlocks.ts` 接線本身還沒做 |
| Phase 5 | 🟡 子階段(a)已完成，(b)/(c)未開始 | 規模比原計畫描述大得多，拆成三個獨立子階段（見第5.1節設計提案）：(a) 行程規劃 LLM 呼叫 + 回程日拼圖——**已完成**（見 0.4 節，過程中抓到一個真的 bug）；(b) 逐城市套用 Phase 3/4 既有管線、(c) SSE 協定 v2 + 前端重寫——都還沒開始，兩個新函式目前完全沒接進 `generate-stream/route.ts` |
| Phase 6 | ⬜ 未開始 | 清理舊路徑，見第5節 |

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

### 0.3 Phase 4：範圍改道，transit day 到達景點接上規則引擎（已完成）

9. **`assignCityBlocks.ts` 接線評估：風險高、價值低，改道**：Phase 4 原計畫
   （第5節）寫的是「把 `assignCityBlocks.ts` 接上 restructure 的城市分塊邏輯」。
   實際比對 `planCityBlocks`/`computeSightseeingBudget` 跟 `restructure/route.ts`
   現有的 `buildCityBlock` 邏輯後發現：(a) `planCityBlocks` 的預算算式
   （`structuralDaysUsed`）沒把自己輸出的 `dropsStoredOutboundDay` 考慮進去，
   直接接線會少算一天要生成的觀光日；(b) route.ts 裡「既有城市的舊移動日在
   下一站城市換了以後要重新生成 stops」那段邏輯（route.ts:143-154）
   `assignCityBlocks.ts` 完全沒涵蓋，它只處理天數算術，不處理「哪個 day 物件
   要保留 vs 重新生成」。也就是說直接接線不是無風險的機械式替換，要嘛先修
   `assignCityBlocks.ts` 補上這兩個落差，要嘛只換掉本來就沒問題、兩邊算法
   等價的那一小段算術（等於白工）。跟你確認後決定不做，`assignCityBlocks.ts`
   接線維持未接狀態。
10. **`generateTransitDayStops` 到達景點換成規則引擎**（PR #13，分支
    `feat/multi-city-transit-scheduler`）：改道後選的方向——這個函式原本一個
    LLM 呼叫要做三件事：出發前微行程、交通本身（方式/時長）、到達後景點。
    只有「到達後景點」適合換成規則引擎；「兩城市間距離多遠、該搭飛機/高鐵/
    巴士」是真實世界常識判斷，現有 `distanceMatrix.ts` 的 `getDistance`/
    `pickModeForDistance` 只認 walking/transit/driving，是給一天內站點短距離
    用的，沒有洲際/跨國距離或航班的資料來源可以取代 LLM，這部分維持給 LLM
    判斷。新增 `planTransitDay()`：收窄後的 LLM 呼叫只輸出
    `{prepStops, transitStop, arrivalActivityCount, arrivalTime}`——距離/交通
    判斷邏輯（含原本的短/中/長程指引文字）保留，但不再讓模型自己發明到達
    城市的景點名稱，只輸出「要排幾個、大概幾點到」。真正的到達景點交給新的
    `generateTransitDayStopsViaScheduler()`，重用跟 `generateDayStopsViaScheduler`
    完全同一套管線（`getCityCenter` → `fetchNearbyPlaceCandidates` →
    `placeCandidatesToStopCandidates` → `buildDaySkeleton` →
    `generateSkeletonCopy`），`count`/`dayStartMinute` 改吃 LLM 判斷出的
    `arrivalActivityCount`/`arrivalTime`。順手把兩邊重複的「組裝成 Stop 形狀」
    邏輯抽成共用的 `assembleScheduledStops()`。任一步失敗（LLM 解析失敗、拿
    不到城市座標、候選池空）就整段 fallback 回原本改名為
    `generateTransitDayStopsWithLLM` 的純 LLM 實作。用真實資料驗證過短程
    （大阪→京都：交通判斷正確、到達後排出 4 個真實京都景點，地理分散但都是
    真實地標）跟長程（布達佩斯→捷克克魯姆洛夫：正確只回傳交通本身，
    `arrivalActivityCount` 判斷為 0，完全跳過候選池查詢，不硬塞不合理的
    到達景點）兩種情境，符合預期。**已知限制**：`prepStops`（出發前微行程）
    維持 LLM 生成，還是可能幻覺——這次沒解決，量小、非重災區，故意排除在
    範圍外。

### 0.4 Phase 5 子階段(a)：行程規劃 LLM 呼叫 + 回程日拼圖（已完成，尚未接線）

11. **`planTrip()`——新的「行程規劃」LLM 呼叫**（`src/lib/tripPlan.ts`，新檔案）：
    `generate-stream` 首次生成目前完全沒有結構化城市清單，去幾個城市、各待
    幾天是 LLM 在一次生成完整行程的 completion 裡自己決定的。這個新函式把
    這個決策單獨拆出來，架構比照已有的 `parsePreferenceIntent()`：小 prompt、
    `response_format: json_object`、Zod 驗證（`TripPlanSchema`）、失敗
    （JSON/schema 錯誤、天數加總對不上）重試1次、最終失敗回傳 `null`。
    `days` 語意比照 restructure 的 `targetDays`：第一個城市不含移動日，其餘
    城市含抵達它的移動日，全部加總須等於「總天數 - 1」（最後一天固定是回程
    日，交給下面第12點處理，不算進任何城市配額）。Prompt 重用既有的
    `buildFlightTimePrompt()`/`buildPreferencePrompt()`（`itineraryGen.ts`），
    不重新發明航班時間/偏好文字。**同日期單日來回行程**（`calcDays` 算出
    總天數 ≤ 1）直接跳過呼叫回傳 `null`——這種情況天數加總的目標值是0，
    schema 又要求每個城市至少1天，無論如何都不可能有合法回應，硬打兩次
    API 只會浪費呼叫次數。
12. **`generateDepartureDayStops()`——回程日拼圖**（`itineraryCityGen.ts`，
    新函式）：設計提案裡唯一沒有 Phase 3/4 前例可抄的部分——最後一天（回程
    航班出發前）在最後一個城市裡還有半天空檔，但這次**不需要 LLM 判斷排幾個**
    （跟 Phase 4 的到達景點不同，純粹是時鐘算術，不涉及「兩城市多遠」這種
    真實世界常識判斷）。先抽一個純函式 `computeDepartureDayBudget()`
    （`src/lib/scheduler/departureDayBudget.ts`，比照 `assignTimeSlots.ts`
    的純函式+單元測試慣例）：用 `returnDepartureTime` 往前推3小時當硬性
    收尾時間（沒有這個航班欄位就用保守預設14:00），估算塞得下幾個景點
    （上限3個）。主函式管線跟 `generateDayStopsViaScheduler`/
    `generateTransitDayStopsViaScheduler` 共用的部分完全重用，`buildDaySkeleton`
    排完後用 `s.endMinute <= cutoffMinute` 過濾超時尾段（`assignTimeSlots`
    排程嚴格遞增，過濾只會砍尾巴不會留缺口）——不修改 `assignTimeSlots`/
    `buildDaySkeleton` 本身。任何一步失敗（含估算出0個景點、拿不到城市座標、
    候選池空）都回傳空陣列 `[]`（不是 `null`——這個拼圖沒有「純 LLM 版本」
    可以 fallback，空陣列本身就是合理結果，例如班機太早）。順手把 Phase 4
    的 `parseArrivalTime` 泛化成 `parseTimeString(raw, fallbackMinute)`，
    兩處解析 HH:MM 共用同一個函式。
13. **驗證抓到一個真的 bug**：真實測試單城市來回（雪梨5天）時，`planTrip()`
    兩次嘗試都無視自己的規則，硬加了墨爾本、布里斯本湊成多城市行程——prompt
    裡「只能有這一個城市」那句太弱，模型沒理它。加強成明確的【重要】區塊
    （強調「這不是開口式行程」、`cities` 陣列長度必須恰好是1）+ 一段天數
    加總的具體範例後，重跑兩次都穩定只回傳一個城市、天數也對。這跟 Phase 1
    「不吃辣→no_seafood」、原本大 prompt 需要一堆「絕對不可」式強調句是
    同一種教訓：小 prompt 一樣需要夠強的措辭，不能因為輸出結構小就假設
    模型會乖乖照做。
    - 單元測試：`src/lib/tripPlan.test.ts`（mock OpenAI，比照
      `preferenceIntent.test.ts`）、`src/lib/scheduler/departureDayBudget.test.ts`
      （純函式，7個案例涵蓋正常/太早/邊界/無 returnDepartureTime 等情境）。
    - 真實資料驗證：多城市（東京大阪7天）正確分配 東京3+京都2+大阪1=6（模型
      自己合理加了京都當中途站）；單城市（雪梨5天）修好後穩定回傳 雪梨4；
      回程日（大阪15:30航班）真實排出3個大阪景點；回程日（大阪08:00航班）
      正確回傳空陣列。
    - **這兩個函式這輪只獨立存在、獨立測試，沒有接進 `generate-stream/route.ts`**
      ——接線是 Phase 5(b)/(c) 的事。

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

#### 5.1 Phase 5 設計提案（2026-09-17，探索完成，尚未實作/未核准）

開始規劃這步才發現規模比原本這段描述大得多，記錄下來避免之後重複踩坑。

**跟 Phase 3/4 的關鍵差異**：restructure 的 `CitySchema`（幾個城市、各住幾天）
是使用者在 UI 上先選好才送進來的結構化資料；但首次生成（`generate-stream`）
只有機場代號+日期+一段自由文字，去幾個城市、各待幾天，完全是 LLM 在一次
completion 內部自己決定的，沒有現成的結構化「城市清單」可以直接餵給規則
引擎。而且前端（`StreamingPreview.tsx`）是用 regex 硬解析「還沒完整的 JSON
字串」做逐步顯示（括號計數去補完未閉合的 JSON），跟現有 SSE 逐字元串流格式
深度綁定——後端要真的做到「規則引擎秒回骨架、文案漸進補上」，SSE 協定
（`chunk`/`retry`/`complete` 三種事件）和前端解析邏輯必須一起重新設計，
不是單純換後端實作。

**提案架構**（尚未核准，供討論）：

1. **新增「行程規劃」LLM 呼叫**（新能力，`src/lib/tripPlan.ts` 之類）：輸入
   flightInfo（含算好的 `calcDays()` 總天數）、自由文字 `prompt`、
   `TripPreferences`；輸出結構化
   `{ cities: [{ name: string, days: number }] }`（第一個城市對應
   `arrivalCity`、最後一個對應 `returnDepartureCity`，單城市行程
   `cities.length === 1`）。`days` 語意比照 restructure 的 `targetDays`
   ——新城市的 `days` 包含它自己的抵達移動日（陣列裡第一個城市除外，因為
   抵達當天就是航班本身，不算移動日）。這一步呼叫小、輸出小，比現在整段
   20+ 條規則的巨型 prompt 快很多，是真正能做到「秒級回骨架」的第一步。
   `sum(city.days)` 必須等於總天數減 1（見第4點的回程日）；解析/加總對不上
   就整段 retry（這是唯一還需要「重試整個行程」的失敗模式，且呼叫本身小很多，
   retry 成本遠低於現在）。
2. **逐城市套用 Phase 3/4 已有的規則引擎管線**：對 `cities` 陣列裡每個城市，
   套用 restructure `buildCityBlock` 的「新城市」分支邏輯（因為首次生成裡
   每個城市都相當於「新城市」，沒有「保留舊 day」的概念）——呼叫
   `generateTransitDayStops()`（第一個城市除外，它的「移動日」就是去程航班
   本身，不需要生成；其餘城市沿用 Phase 4 已做好的
   `generateTransitDayStopsViaScheduler`）+ `generateDayStops()`（沿用
   Phase 3 的 `generateDayStopsViaScheduler`）+ `generateMealsAndAccommodation`
   （這塊目前完全沒有規則引擎化，維持純 LLM，見下方第6點）。這一大塊幾乎是
   純重用，不需要新寫排程邏輯。
3. **新的「回程日」小拼圖（目前沒有對應實作，需要新設計）**：現有大 prompt
   的規則7/17 是「最後一天不需要住宿，但抵達城市的移動日結束後仍要排 1 個
   以上的輕鬆景點」——回程日是對稱的鏡像情境：最後一個城市裡「回程航班出發
   前」還有半天空檔，需要用 `flightInfo.returnDepartureTime` 往前推 3 小時
   當作硬性收尾時間，從最後城市的候選池排 0-3 個景點。`buildDaySkeleton`
   目前只有 `dayStartMinute`（起始時間），沒有「必須在 X 分鐘前結束」的硬
   約束，需要小擴充（或簡化成依可用時數直接砍 count，不強求精確卡點）。
   這塊沒有 Phase 3/4 的直接前例可抄，是這次探索中唯一需要全新設計的排程
   邏輯，工作量/風險都比其餘部分高，建議拆成獨立一步。
4. **新的 SSE 事件詞彙**（取代現有的 `chunk`/`retry`/`complete` 三種）：
   - `type: "plan"`：第1點的行程規劃結果一算完就送出（`cities` 陣列），
     前端可以立刻畫出「N 個城市、每城市幾天」的骨架卡片（有幾天空殼、標題
     未定），比現在等一整段 JSON 打完快非常多。
   - `type: "day"`：每一天的骨架+文案組裝完成就送一個（`dayIndex`,
     完整的 Day 物件），城市之間、甚至同城市不同天的生成可以平行跑，用
     `Promise.allSettled` 收集，完成一個送一個，不必等全部。
   - `type: "retry"`：語意窄化成「第1點的行程規劃呼叫失敗重試」，不再是
     「整段大 JSON 重來」。
   - `type: "complete"`：所有 `day` 事件送完、存檔後送出（可以只帶
     `id`，因為前端已經靠 `day` 事件把完整資料組出來了，不需要再整包送
     一次）。
   - `type: "error"`：維持，但語意也窄化——單一城市/單一天失敗時走 Phase 3/4
     已有的 fallback（退回該城市/該天的純 LLM 生成），不會讓整趟行程失敗；
     只有第1點的行程規劃呼叫重試用盡才真的整趟失敗。
5. **前端重寫**（`useStreamingGenerate.ts` + `StreamingPreview.tsx`）：拿掉
   regex 硬解析未完成 JSON 那段（現有 fragile 的括號計數補完邏輯），改成
   直接依 SSE 事件型別更新一個結構化的 `Itinerary` state——收到 `plan` 先
   建立 N 個城市、每天一個「還沒資料」的骨架卡（沿用現有 skeleton loader
   UI），收到每個 `day` 事件就把對應那天的骨架卡換成真實內容。比現在的
   regex 解析更穩定、也更貼近「規則引擎骨架先出現、文案逐步補上」這個
   Phase 5 想要的體驗。
6. **範圍外，留給之後**：`generateMealsAndAccommodation` 完全沒有規則引擎化
   （沒有用到已存在的 `fetchCityRestaurants`/`getLodgingTypes`/
   `getPriceLevels` 這些候選池函式，即使 `meals/[mealType]/regenerate`、
   `accommodation/regenerate` 這兩個既有 route 已經在用），現有大 prompt
   規則12-15（餐廳來源分類、禁用場所類型、反重複）全部繼續留給 LLM。這是
   明顯可見的下一塊延伸（跟 Phase 3 把 `generateDayStops` 換掉是同一種
   問題），但這次不在範圍內，避免一次改太多。
7. **retry/validation 語意跟著整個變小**：`validateItinerary`/
   `validateGeography` 還是在組裝完成後跑一次當最後防線，但重試單位從
   「整段 20+ 條規則的大 JSON」縮小到「單一城市/單一天」（Phase 3/4 已建立
   的 fallback 模式），加上第1點行程規劃呼叫本身的小型 retry。`MAX_GENERATION_ATTEMPTS`
   這個常數的意義會整個改變，需要重新設計（可能拆成「行程規劃重試次數」
   跟「個別城市/天的 fallback」兩種不同機制，不再是同一個計數器）。

**這輪的產出是設計，不是實作**——工作量明顯比 Phase 3/4 任何一步都大，
建議拆成至少三個獨立可上線的子階段：(a) 行程規劃 LLM 呼叫 + 回程日拼圖，
(b) 逐城市套用既有規則引擎管線（重用為主），(c) SSE 協定 v2 + 前端重寫。
三者可以照這個順序分別開分支/PR，每步都能獨立驗證，不需要一次全部做完。

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

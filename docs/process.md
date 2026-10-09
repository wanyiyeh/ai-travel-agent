# 開發歷程記錄（Process Log）

> 用途：按日期記錄每次工作階段做了什麼、發現什麼、為什麼做出某個決定。
> 跟 `plan/hybrid-rule-engine-scheduling.md` 的差異：那份是活的技術計畫文件（隨階段更新進度表），
> 這份是時間軸式的流水記錄，方便回顧「這一天實際發生了什麼」。

---

## 2026-09-15

延續 [plan/hybrid-rule-engine-scheduling.md](../plan/hybrid-rule-engine-scheduling.md) 的 Phase 1、Phase 2。

### 1. Phase 2 影子模式：規則引擎 vs LLM 骨架比對（`814e5b5`）

- 新增 `scripts/shadow-compare-scheduler.ts`（`npm run shadow-compare`），對種子資料庫裡
  每一天有完整 LLM 排序 + 真實座標的行程，用同一批 stop 跑 `buildDaySkeleton`，
  比對 stop 順序、`time_of_day`、`duration_minutes` 估計值跟 LLM 實際產出的差異。
  純讀取、不寫資料庫、不呼叫 OpenAI/Places。
- 第一次真實跑的數字：42 個可比較天數，順序完全相同 36%、平均每站位置差 0.64、
  `time_of_day` 一致率 43%、時長估計平均誤差 63 分鐘（信心度低）。
- 發現新風險：候選池完全沒有 Place `type` 資料，時長估計幾乎都落在 flat 60 分鐘
  fallback，而不是真的依類型估算——需要先解決才能繼續往 Phase 3 推進。

### 2. 補真實 Place type，追查時長估計落差（`f5c2081`）

- 新增 `mapPlaceTypeToCategory.ts`：把 Place 的原始 Google `types[]` 對回
  `assignTimeSlots` 用的六種時長分類，優先比對最具體的分類避免被籠統標籤誤判。
- 新增 `scripts/backfill-place-types.ts`：一次性、成本可控的回填
  （只查已經被選進真實行程的 57 個 placeId，不查整個候選池）。
- 把真實 type 接進 `shadow-compare-scheduler.ts`，並統計每天有多少站點拿到真實分類
  vs 落到 flat fallback。
- **結果**：108 站中 83 站拿到真實 type，但平均時長誤差反而從 63 分鐘惡化到
  67 分鐘。推翻了「缺 type 資料是問題根源」的假設——問題其實是
  `DEFAULT_DURATION_BY_TYPE` 這張對照表本身的數字從沒被校準過。

### 3. 嘗試用真實資料校準時長對照表，結果推翻了這個方向（`c08ccf1` 的 Phase 2 部分）

- 新增 `scripts/calibrate-duration-table.ts`，想拿種子資料庫裡真實的
  `duration_minutes`（按真實 Place type 分桶）重新校準對照表。
- **結果**：museum/temple/park/landmark 幾個類別的中位數幾乎收斂在同一個數字，
  追查後發現 LLM 本身在 53% 的情況下，不管景點類型一律給 120 分鐘。
  也就是說 `duration_minutes` 從來就不是「依類型決定」的可信 ground truth，
  往它校準學不到東西。
- **決定**（已寫入計畫文件第7節）：規則引擎的時長估計在有更好的外部資料源
  （例如公開的平均參觀時長統計）之前，維持現有 placeholder 對照表，並標記為
  近似值，不當作這次重構比 LLM 更準的賣點。先往下推進其他階段。

### 4. Phase 1 補上缺的驗收標準，順手抓到一個真的 prompt bug（`c08ccf1` 的 Phase 1 部分）

- 新增 `scripts/validate-preference-intent.ts`：對 18 組具代表性的自由文字
  （單一訊號、多重訊號、中性、矛盾、英文、邊界案例）跑真實 `parsePreferenceIntent()`
  供人工抽查，補上 Phase 1 一直沒做的驗收步驟。
- **抓到的 bug**：「不吃辣」有約 60% 機率被誤解析成 `no_seafood`。原因是
  prompt 的 `dietaryRestrictions` 範例清單裡沒有辣度相關的標籤，模型會套用
  「最接近的範例」而不是使用者真正說的限制。
- **修法**：在 `src/lib/preferenceIntent.ts` 的 system prompt 加入
  `no_spicy`/`no_beef` 範例，並明確要求標籤要對應使用者實際說的限制，
  不要套用最接近的範例。修完重跑 6 次皆正確。其餘 17 組人工檢查合理。

### 今天的結論

- Phase 1 驗收標準補齊，且過程中順手修掉一個影響真實使用者（吃辣/不吃辣）的 prompt bug。
- Phase 2 影子模式的骨架比對數據已經有了，但時長估計這條路線調查到底發現是
  死路（LLM 種子資料本身不是可信的校準來源）——這是一次「證明某個方向行不通」
  的有效調查，範圍調整已經記錄進計畫文件，避免之後重複踩同一個坑。
- 下一步：Phase 3 單城市試點，時長估計先接受現有 placeholder 當近似值。

---

## 2026-09-16

延續 [plan/hybrid-rule-engine-scheduling.md](../plan/hybrid-rule-engine-scheduling.md) Phase 3：開始規劃單城市試點時，
逐一解掉三個把規則引擎接進真實生成路徑前必須先有的積木。

### 1. 候選池補座標/類別（`f98bd37`）

- 開始設計 Phase 3 前先盤點：正式流程唯一的候選池來源 `fetchCityRestaurants.ts` 的
  `RestaurantHint` 只有 `{name, rating?}`，完全沒有 `buildDaySkeleton` 必填的
  `lat`/`lng`，也沒有類別可以餵 `mapPlaceTypeToCategory`。
- 擴充 `searchNearbyHints()` 的 field mask 加入 `places.location`/`places.types`，
  `RestaurantHint` 新增可選的 `lat`/`lng`/`types`，不影響現有只讀 name/rating 的
  prompt-building 呼叫端。用真實 API 呼叫驗證欄位格式正確。
- **成本備註**：這是持續性的小額外成本（以後每次正式生成都多拉兩個欄位），不是
  一次性費用，跟之前 Phase 2 那種一次性回填不同，已在計畫文件標明。現有
  `CityPlaceHintsCache` 快取列在 30 天 TTL 到期前仍是舊格式，不強制清快取。

### 2. hint → candidate adapter（`da75d73`）

- 新增 `src/lib/scheduler/hintsToStopCandidates.ts`：把 `RestaurantHint[]` 轉成
  `buildDaySkeleton` 吃的 `StopCandidate[]`——濾掉還沒補到座標的（例如尚未過期的
  舊快取列）、用 `mapPlaceTypeToCategory` 算 `type`。因為 `StopCandidate`/
  `ScheduledStop` 本身不帶 name，adapter 同時回傳 `hintById` map 供之後查回真實
  地點名稱。
- 用真實東京景點資料端到端測過：fetch hints → adapter → `buildDaySkeleton`，
  能跑出合理骨架。

### 3. LLM 只補文案：`generateSkeletonCopy`（`da9c102`）

- 混合架構這條鏈裡最後一個還缺的 LLM 呼叫，也是計畫第4b節設計已久但一直沒做的
  部分：規則引擎（`buildDaySkeleton`）先把一天的 stop、順序、時段都排好之後，
  交給一個小而單一職責的 LLM 呼叫，只補風格化文案。
- 新增 `SkeletonCopySchema`（`src/lib/schemas.ts`）：輸出限定
  `{ dayTheme?, stops: Record<stopId, {description, highlight?}> }`，schema 裡
  完全沒有時間/順序/地點欄位，模型就算幻覺多餘 id 或欄位也污染不到骨架
  （單元測試驗證過幻覺 id 會被直接忽略）。
- 新增 `src/lib/skeletonCopy.ts` 的 `generateSkeletonCopy()`：跟 `parsePreferenceIntent`
  同一種設計哲學（小、單一職責、Zod 驗證），但多一層保證——回傳一定涵蓋骨架裡
  每一個 stop id：模型漏掉的 stop、schema 不合法的回應、API 呼叫失敗，各自
  degrade 成通用 fallback 文字，不會讓單一景點沒描述、也不會讓整天失敗。
- `transport_from_prev` 這次刻意不交給 LLM，維持沿用現有規則版
  `describeTransport()`，避免一次擴大太多範圍。
- 已用真實 OpenAI 呼叫端到端測過整條鏈（fetch hints → adapter →
  `buildDaySkeleton` → `generateSkeletonCopy`），文案品質人工檢查合理，語氣自然不生硬。

### 今天的結論

- Phase 3 需要的三塊積木（候選池座標/類別、hint→candidate adapter）+ 計畫第4b節
  的 LLM 文案層全部完成，而且是第一次每一塊都用真實資料（真實 Places API + 真實
  OpenAI）端到端測過，不只是離線分析。混合架構規劃的所有規則引擎積木 + 文案生成
  模組至此都已就緒，各自有單元測試。
- 整條鏈目前還是獨立模組，**沒有任何真實使用者路徑在用**——下一步是接進
  `itineraryCityGen.ts`（或決定的正式路由），並用 `npm run dev` 實際跑過 UI，才算
  Phase 3 真正完成。這是目前為止唯一會真的動到 production 生成路徑的一步，風險
  比前面幾步都高，需要更謹慎地規劃（例如先限定在單城市、非 transit day 這個
  最簡單的情境）。

---

## 2026-09-17

延續 [plan/hybrid-rule-engine-scheduling.md](../plan/hybrid-rule-engine-scheduling.md) Phase 3：把前一天做好的規則引擎積木
第一次接進真實生成路徑。

### 1. `generateDayStops()` 換引擎，簽章不變（`a916706`，PR #11）

- `restructure/route.ts` 的 `generateDayStops()` 一直是純 LLM 憑空生成景點，是
  Phase 3「單城市試點」計畫指名的最簡單情境。把原本的 LLM 實作改名
  `generateDayStopsWithLLM`（private, fallback 用），匯出的 `generateDayStops()`
  先試新的 `generateDayStopsViaScheduler()`：串起 `getCityCenter` →
  `fetchNearbyPlaceCandidates` → `placeCandidatesToStopCandidates` →
  `partitionCandidatesByDay` → `buildDaySkeleton` → `generateSkeletonCopy`，再用
  `distanceMatrix.ts` 算 `transport_from_prev`、`priceLevelCost.ts` 算
  `estimated_cost`。
- **設計決策**：簽章完全不變，`restructure/route.ts` 兩處呼叫點幾乎不用改
  （只多傳一個 `lockedPlaceIds` 避免規則引擎把使用者鎖定的景點重複排進去）。
  任何一步失敗（拿不到城市座標、候選池空）就整個城市 fallback 回原本的純 LLM
  實作——不會比現在更差，風險降到最低。
- 用真實京都資料端到端驗證過一次（`generateDayStops("京都", 2, "TWD")`），兩天
  都成功走新引擎，地點真實、文案無幻覺，已知限制（時長估計近似值、第一站沒有
  `transport_from_prev`、候選分群偶爾地理上偏散）都跟計畫文件第7節記錄的風險
  一致，不是新 bug。

### 2. budget / `PreferenceIntent` 接進 `restructure/route.ts`（`5424271`，PR #12）

- 排進計畫待辦的下一項。探索後發現這個 app 其實有兩套分離的偏好資料：
  `config.preferences`（表單選的結構化 `TripPreferences`，嚴格 enum）和
  `config.generatedWith`（自由文字，要重新呼叫 `parsePreferenceIntent()` 才能
  解析）。這次接的是後者——待辦原文指名的「PreferenceIntent」。
- `POST` 一開始從 `config.preferences.budget` 讀預算、對 `config.generatedWith`
  跑一次 `parsePreferenceIntent()`（整趟行程只算一次，不分城市），往下傳給
  `generateDayStops()` 新增的 `budget`/`preferenceIntent` 參數：`budget` →
  `getPriceLevels()` 篩候選池（沿用 accommodation/meals regenerate 既有的
  「空結果就重試不篩價位」模式）；`pace`/`startTimePreference` 直接餵給
  `buildDaySkeleton`；`interestBoost`（自由標籤，非 enum）加一個小範圍對照表
  映射到 `DurationCategory` 權重，對照不到的標籤就是不加權；`avoid`/
  `dietaryRestrictions` 沒接候選篩選，但透過 `generateSkeletonCopy` 改吃真正的
  `preferenceIntent` 自動反映在文案語氣裡。
- **刻意排除**：`TripPreferences.pace`/`interests`（表單那一套）不接，避免跟
  `PreferenceIntent.pace` 打架，維持待辦原文指名的範圍。
- 用真實京都資料對照「中性參數」vs「luxury + relaxed + late + art/history」
  兩組呼叫：`pace`/`startTimePreference` 效果明顯（時段從全部 morning 變成部分
  afternoon）；但 `budget`/`interestBoost` 這次沒看出候選被換掉——京都熱門景點
  池子小、多數廟宇/市場沒有 Google `priceLevel` 標籤，價位篩選十之八九觸發空
  結果 fallback，是資料特性使然，不是接線的 bug。

### 3. Phase 4 範圍改道，transit day 到達景點換成規則引擎（`91761e0`，PR #13）

- 開始規劃 Phase 4 時，原計畫寫的是「把 `assignCityBlocks.ts` 接上
  `restructure/route.ts` 的城市分塊邏輯」。比對 `planCityBlocks`/
  `computeSightseeingBudget`（Phase 3.1 就寫好、從沒接過線的純函式）跟
  `buildCityBlock` 現有邏輯後發現：這條路線不是無風險的機械式替換——
  `planCityBlocks` 的預算算式沒把自己輸出的 `dropsStoredOutboundDay` 考慮
  進去（會少算一天觀光日），而且完全沒涵蓋「既有城市的舊移動日在下一站城市
  換了以後要重新生成 stops」那段邏輯（route.ts:143-154，決定的是「哪個 day
  物件要保留 vs 重新生成」，不是算天數）。跟使用者確認後，Phase 4 改道，
  `assignCityBlocks.ts` 接線維持未接狀態。
- 改接 `generateTransitDayStops`——這個函式還是 100% 純 LLM，而且明顯有跟
  Phase 3 的 `generateDayStops` 同一種問題（到達城市後的景點是 LLM 憑空發明
  的）。但這次職責要拆更細：函式原本一次 LLM 呼叫做三件事（出發前微行程、
  交通本身、到達後景點），只有「到達後景點」適合換規則引擎——「兩城市間
  距離多遠、該搭飛機/高鐵/巴士」是真實世界常識判斷，現有
  `distanceMatrix.ts`（`getDistance`/`pickModeForDistance`）只認
  walking/transit/driving，是給一天內站點短距離用的，沒有洲際/跨國距離或
  航班的資料來源可以取代 LLM，這部分維持給 LLM 判斷。
- 新增 `planTransitDay()`：收窄後的 LLM 呼叫只輸出
  `{prepStops, transitStop, arrivalActivityCount, arrivalTime}`——距離/交通
  判斷指引文字整段保留，但不再讓模型自己發明到達城市的景點名稱，只輸出數量
  跟大概抵達時間。到達景點交給新的 `generateTransitDayStopsViaScheduler()`，
  重用 `generateDayStopsViaScheduler` 完全同一套管線，`count`/
  `dayStartMinute` 改吃 LLM 判斷出的值。順手把兩邊重複的「組裝成 Stop 形狀」
  邏輯抽成共用的 `assembleScheduledStops()`，減少重複。任一步失敗就整段
  fallback 回原本改名為 `generateTransitDayStopsWithLLM` 的純 LLM 實作，
  跟 Phase 3 建立的 fallback 模式一致。
- 用真實資料驗證兩種情境：短程（大阪→京都）交通判斷正確（新幹線15分鐘），
  到達後排出 4 個真實京都景點（清水寺、伏見稻荷、金閣寺、嵐山），地理上
  分散但都是真實地標；長程（布達佩斯→捷克克魯姆洛夫）正確只回傳交通本身
  （巴士5小時），`arrivalActivityCount` 判斷為 0，完全跳過候選池查詢，不
  硬塞不合理的到達景點。兩組結果都符合原本 prompt 的短/中/長程規則。

### 4. Phase 5 設計探索：規模比原計畫大得多（`docs/process.md`/`plan/hybrid-rule-engine-scheduling.md`，PR #14）

- 開始規劃 Phase 5（收斂 `generate-stream` 主流程）才發現規模比計畫文件原本
  一小段描述大得多，有兩個結構性差異跟 Phase 3/4 都不一樣：(1)
  `StreamingPreview.tsx` 用 regex 硬解析「還沒完整的 JSON 字串」做逐步顯示
  （括號計數補完未閉合 JSON），跟現有 SSE 逐字元串流格式深度綁定，規則引擎
  要做到「秒回骨架、文案漸進補上」必須連 SSE 協定和前端一起重新設計；(2)
  `generate-stream` 完全沒有像 restructure `CitySchema` 那樣結構化的城市
  清單——去幾個城市、各待幾天是 LLM 在一次 completion 裡自己決定的，沒有
  現成資料可以直接餵給規則引擎。
- 寫出完整設計提案（`plan/hybrid-rule-engine-scheduling.md` 第5.1節）：新增
  「行程規劃」LLM 小呼叫（新能力）+ 逐城市重用 Phase 3/4 管線（幾乎純重用）
  + 新的「回程日」拼圖（唯一沒有前例、需要全新設計的部分）+ 新 SSE 事件
  詞彙（`plan`/`day`/`retry`/`complete`/`error`）+ 前端重寫（拿掉 fragile 的
  regex 解析，改成依結構化事件更新 state）。retry/validation 語意也整個
  變小：從「整段大 JSON 失敗重來」變成「單一城市/單一天 fallback」。建議
  拆成三個獨立子階段：(a) 行程規劃呼叫+回程日拼圖、(b) 逐城市套用既有管線、
  (c) SSE 協定 v2 + 前端重寫。
- 這一步只產出設計文件，沒有動任何程式碼。

### 5. Phase 5 子階段(a)：行程規劃呼叫 + 回程日拼圖（分支 `explore/generate-stream-phase5`，尚未 merge）

- 新增 `planTrip()`（`src/lib/tripPlan.ts`）：小 LLM 呼叫決定城市清單/天數
  分配，架構比照 `parsePreferenceIntent()`（Zod 驗證、失敗重試1次、最終
  失敗回傳 `null`）。同日期單日來回行程直接跳過呼叫（天數加總目標是0，
  schema 又要求每城市至少1天，怎麼樣都不可能有合法回應，不浪費 API 呼叫）。
- 新增 `generateDepartureDayStops()`（`itineraryCityGen.ts`）：回程日拼圖，
  跟 Phase 4 的到達景點不同——**排幾個景點不需要 LLM 判斷**，純粹是拿
  `returnDepartureTime` 往前推3小時的時鐘算術。先抽一個純函式
  `computeDepartureDayBudget()`（`src/lib/scheduler/departureDayBudget.ts`，
  比照 `assignTimeSlots.ts` 慣例）估算塞得下幾個景點，主管線重用跟
  Phase 3/4 完全同一套（候選池 → `buildDaySkeleton` → 事後用
  `endMinute <= cutoffMinute` 過濾超時尾段 → `generateSkeletonCopy`），不
  修改 `assignTimeSlots`/`buildDaySkeleton` 本身。任何一步失敗都回傳空陣列
  （這個拼圖沒有「純 LLM 版本」可以 fallback，空陣列本身就是合理結果）。
- **驗證抓到一個真的 bug**：真實測試單城市來回（雪梨5天）時，`planTrip()`
  兩次嘗試都無視自己的規則，硬加了墨爾本、布里斯本湊成多城市行程——prompt
  裡「只能有這一個城市」那句太弱。加強成明確的【重要】區塊（強調「這不是
  開口式行程」、陣列長度必須恰好是1）+ 天數加總的具體範例後，重跑兩次都
  穩定只回傳一個城市。這跟 Phase 1「不吃辣→no_seafood」是同一種教訓：小
  prompt 一樣需要夠強的措辭，不能因為輸出結構小就假設模型會乖乖照做。
- 新增單元測試 `tripPlan.test.ts`（mock OpenAI）、`departureDayBudget.test.ts`
  （純函式，7個案例）。真實資料驗證：多城市（東京大阪7天）正確分配
  東京3+京都2+大阪1=6；單城市（雪梨5天）修好後穩定回傳雪梨4；回程日
  （大阪15:30航班）真實排出3個真實景點；回程日（大阪08:00航班）正確回傳
  空陣列。
- **這兩個函式這輪只獨立存在、獨立測試，沒有接進 `generate-stream/route.ts`**
  ——接線是 Phase 5(b)/(c) 的事。

### 6. Phase 5 子階段(b)：逐城市套用既有管線，組出完整行程（分支 `feat/generate-stream-city-loop`，尚未 merge）

- 新增 `assembleItineraryDays()`（`src/lib/assembleItineraryDays.ts`）：把
  `planTrip()` 的輸出跟已經內建 fallback、保證回傳可用結果的
  `generateDayStops()`/`generateTransitDayStops()`/`generateDepartureDayStops()`
  串起來，逐城市組出完整 `days` 陣列。因為這三個生成函式從不拋錯，
  `assembleItineraryDays` 唯一要處理失敗的地方只有 `planTrip()` 本身回傳
  `null`，函式本身很單純。
- 設計時發現三個 (a) 沒處理到的落差：`currency` 沒有資料源（讓 `planTrip()`
  順便多吐 `currency`/`title`，不用多開一次呼叫）、回程日的三餐沒人生成
  （對最後一個城市多要一天份的餐分給回程日）、行程第1天沒考慮航班抵達時間
  ——這項先跟使用者確認要不要做，確認要做後新增對稱於回程日拼圖的
  `computeArrivalDayStartMinute()`（`src/lib/scheduler/arrivalDayStart.ts`）
  和 `generateDayStops()` 的新可選參數 `firstDayStartMinute`（只影響第0天，
  `restructure/route.ts` 既有呼叫不用改）。
- **真實驗證抓到兩個真的問題**（東京大阪7天、雪梨5天，並把結果丟給既有的
  `validateItinerary`/`validateGeography` 交叉驗證）：(1) 移動日完全沒有
  `accommodation`（沿用了 restructure 本身就有的落差，但這次會被
  `generate-stream` 的驗證器當硬性錯誤擋下來）——修成跟同城市區塊的觀光日
  共用同一個已算出的住宿值；(2) **同一城市區塊裡景點重複**——京都的移動日
  到達景點跟隔天觀光日排了一模一樣的兩個地點，大阪的移動日到達景點跟回程日
  三個景點原封不動重複，因為同一城市在一次請求裡可能被三個不同生成呼叫各自
  獨立查同一個小候選池，彼此不知道對方用過哪些地點——這是 (b) 第一次讓同一
  城市被多個生成呼叫命中，Phase 3/4 單獨用時不會踩到。修法是在
  `assembleItineraryDays` 內維護一份跨移動日/觀光日/回程日的 `usedPlaceIds`
  集合，透過 `generateDayStops` 既有的 `lockedPlaceIds` 參數、以及幫
  `generateDepartureDayStops` 新增的同名參數過濾候選池。修完重跑兩組情境
  確認錯誤消失、景點不再重複。
- 這個函式這輪一樣只獨立存在、獨立測試，沒有接進 `generate-stream/route.ts`。

### 今天的結論

- 今天是這個混合架構計畫進度最多的一天：Phase 3 規則引擎積木第一次真正
  接進生產路徑（PR #11），budget/`PreferenceIntent` 接線做完（PR #12），
  Phase 4 發現原定路線風險高價值低、改道換成 transit day 到達景點的規則
  引擎化（PR #13），Phase 5 規劃時發現規模比原計畫大得多、產出完整設計
  提案（PR #14），接著落地了 (a) 行程規劃呼叫+回程日拼圖跟 (b) 逐城市組裝
  完整行程兩個子階段（分支 `feat/generate-stream-city-loop`，尚未
  merge）。全部六次改動都刻意把簽章/呼叫端改動壓到最小，出錯就 fallback
  回舊行為，風險可控；(a)(b) 兩輪都在真實驗證時抓到了真的 bug（prompt 強度
  不足導致單城市限制被無視、移動日缺住宿、同城市景點重複)，都是靠實際跑
  真實 API 資料才發現的，不是單元測試能測出來的。
- Phase 3「單城市試點」還剩一項驗收標準沒做：真人在 `npm run dev` 上走一次
  「重新規劃行程」UI 流程確認端到端沒問題——留給使用者自己做。
- 下一步：Phase 5(c)（SSE 協定 v2 + 前端重寫，把 `assembleItineraryDays()`
  真正接進 `generate-stream/route.ts`）、`assignCityBlocks.ts` 接線（如果
  之後要做，需要先補上 Phase 4 那輪發現的兩個落差）、以及一直懸而未決的
  UI 驗證。

---

## 2026-09-18

延續 [plan/hybrid-rule-engine-scheduling.md](../plan/hybrid-rule-engine-scheduling.md) Phase 5(c)：把前一天做好的
`assembleItineraryDays()` 真正接進 `generate-stream/route.ts`——整個混合架構計畫第一次
真的動到使用者看得到的生成流程。

### 1. `assembleItineraryDays()` 加 progress callback（分支 `feat/generate-stream-sse-v2`）

- 設計時發現這個函式目前是黑盒——呼叫者要等它整個跑完才拿得到結果，沒有中間
  進度可以往外送。要做到「秒回骨架」必須讓它在城市規劃完成、每一天組好時就
  通知呼叫端。新增選填的 `onProgress` callback，`planTrip()` 成功後立刻送
  `{type:"plan", title, currency, cities}`，每組完一天立刻送
  `{type:"day", day}`（順手把函式尾端「跑完全部才用 `.map()` 補 `day` 編號」
  的作法改成即時遞增計數器）。
- **順手修一個 (b) 遺留的真 bug**：`generateMealsAndAccommodation()` 本身沒有
  try/catch，API 錯誤或格式錯誤的回應會直接拋出——`restructure/route.ts`
  每個呼叫點都有包 `.catch()` 降級，但 `assembleItineraryDays()` 少了這層，
  等於「這個函式從不拋錯」的既有承諾其實有漏洞。補上跟 restructure 同款的
  降級模式。

### 2. `generate-stream/route.ts` 接線

- 在現有的大 prompt 重試迴圈**之前**插一段「先試規則引擎路徑」：成功就存檔、
  送 `complete` 事件；`planTrip()` 回傳 `null`、拋錯、或最後
  `validateItinerary` 卡到硬性錯誤，都乾淨落到下面完全不變的舊流程——舊流程
  程式碼一行沒動，把風險壓到最低。
- **發現一個資料保留的細節**：既有的 `addIdsToItinerary` 對每個 stop 一律指派
  新的 `crypto.randomUUID()`，這是為了給「LLM 從來不會給 id」的舊流程補 id。
  但新路徑的 stop 早就帶有真實 placeId（Phase 3/4 的 `assembleScheduledStops`
  查來的）當 id——直接套用會把這個真實資料原地覆蓋掉，白白浪費掉已經解析好
  的地點連結。新增 `addIdsPreservingExisting`，只在 stop 真的缺 id 時
  （LLM fallback 產出的部分）才補新的。
- 新路徑失敗時如果已經送出過 `plan`/`day` 事件，補送一個既有的 `retry` 事件
  讓前端清掉這些漸進式 state，再進入舊流程——沿用 `retry` 事件本來就有的
  「清掉舊 partial 內容」語意，不用新增事件類型。

### 3. 前端：`useStreamingGenerate.ts` / `StreamingPreview.tsx`

- Hook 新增 `plan`/`days` state，處理新的 `plan`/`day` 事件；`complete` 事件
  維持原樣（一律信任 `data.data` 當最終結果，新舊路徑共用同一份邏輯，兩條
  路徑在前端完全獨立、互不影響）。
- `StreamingPreview` 新增一個渲染分支：`plan` 存在時先畫出城市/天數骨架
  （例如「東京 3天 → 京都 2天 → 大阪 1天」），已抵達的 `day` 事件換成真實
  內容，還沒到的維持 skeleton loader；`plan` 不存在時完全維持舊的 regex
  解析渲染邏輯（現有 fallback 行為不動）。

### 4. 驗證

- `tsc`/`lint`/`test`（168個）全過。
- 腳本層級驗證（東京大阪7天真實請求）：事件依序正確送出（`plan` →
  `day 1`...`day 7`，天數嚴格遞增）、`plan` 事件到第一個 `day` 事件間隔約6秒
  ——確認「秒回骨架」這個設計目標真的有達成。
- 使用者在 `npm run dev` 上實際測試瀏覽器端到端流程，確認通過。

### 今天的結論

- Phase 5(c) 完成，也是整個混合架構重構第一次真正影響使用者會看到的畫面
  （前面 Phase 0-4、Phase 5(a)(b) 都只是把積木做好、獨立驗證，從沒接進真實
  使用者路徑）。設計上刻意把新路徑做成「先試、失敗就乾淨退回舊流程」，舊
  流程程式碼完全不動，把這次真正上生產路徑的風險壓到最低。
- 過程中又抓到一個 (b) 遺留的真 bug（`generateMealsAndAccommodation` 缺
  `.catch()`）和一個容易忽略的資料保留細節（真實 placeId 不能被
  `addIdsToItinerary` 洗掉）——這是這個計畫第四次「靠真實資料驗證才抓到的
  問題，不是單元測試測得出來的」。
- 下一步：`generate-stream` 的規則引擎路徑正式上線後，觀察一段時間的真實
  使用狀況（fallback 觸發頻率、生成品質）；Phase 6（清理 `itineraryCityGen.ts`
  裡的舊整段生成呼叫、簡化 `buildSystemPrompt()`）等規則引擎路徑穩定後再做；
  `assignCityBlocks.ts` 接線、Phase 3 的 UI 驗收標準仍然懸而未決。

---

## 2026-09-28

延續 [plan/hybrid-rule-engine-scheduling.md](../plan/hybrid-rule-engine-scheduling.md) 第 0.10 節，
重新評估 Phase 6 能不能移除舊 LLM fallback。

### 1. 批量真實測試規則引擎路徑，結論是移除 fallback 還太早（`91e7cb7`）

- 新增永久保留的診斷腳本 `scripts/batch-test-rule-engine.ts`
  （`npm run batch-test-rule-engine`）：比照 `shadow-compare-scheduler.ts`/
  `validate-preference-intent.ts` 的既有慣例，直接呼叫
  `generate-stream/route.ts` 規則引擎路徑實際用的同一批函式
  （`assembleItineraryDays` → `repairTransitDayDepartureCities`/
  `repairMissingAccommodation` → `validateItinerary` + `validateGeography`），
  複製 route.ts 判斷「這次算成功、還是該 fallback」的完全相同邏輯，
  真的打 OpenAI + Google Places API，不寫 DB、不需要開 `npm run dev`。
- 跑了 8 組情境，涵蓋短程/長程、單城市/多城市、budget 兩極端、冷門城市、
  高強度自由文字偏好——這些軸線先前只靠 2 次手動瀏覽器測試涵蓋過。
- **抓到一個真的、可重現的 `planTrip()` bug**：「台北→巴黎進／羅馬出，
  9 天」這組兩次嘗試，AI 都自己在巴黎、羅馬之間多插了一個城市（兩次答案
  不同，日內瓦、尼斯），但天數分配沒跟著扣，導致原本規劃的最後城市羅馬
  被算成 0 天，違反 schema 驗證。跟 Phase 5(a) 的雪梨過度插入是同一個
  bug 家族，但這次的失敗模式（插入城市擠掉最後城市的天數）不在既有
  prompt 的天數加總檢查涵蓋範圍內。兩次都正確 fallback 回舊流程，沒有
  壞掉，但決定先不修——列為獨立追蹤項目，不在這次清理性質的 Phase 6
  裡臨時展開範圍。
- **更重要的發現**：7/8 成功的案例裡，多數本身品質也不穩——幾乎每一個
  都帶 `STOPS_ALL_SAME_TIME` 警告（呼應 Phase 2 影子模式當初從歷史資料
  算出的「`time_of_day` 一致率僅 43%」，這次用全新真實生成再次重現），
  10 天倫敦單城市行程更帶了 5 個 `DAY_TOO_FEW_STOPS`。這些警告目前不算
  fallback 觸發條件（只有 `severity: "error"` 才算），代表「7/8 成功」
  這個數字本身掩蓋了一批技術上沒 fallback、但生成品質有明顯瑕疵的案例。
- **結論**：Phase 6 移除 fallback 現在還太早，而且原因比原本「樣本數不夠」
  的顧慮更根本——規則引擎路徑本身還有一個真實可重現的失敗模式待修
  （`planTrip` 的插入城市天數扣除邏輯），以及骨架排程品質（`time_of_day`/
  站點數量分佈）目前沒有資料證明贏過舊 LLM 整段生成。兩點都需要真的動
  規則引擎程式碼才能解決，已記錄成獨立範圍的追蹤項目。
- 額外產出 `plan/places-api-cost-reduction.md`：追查 9/17-9/18 那次 Places
  API 費用尖峰的成因（含這次批量測試自己造成的部分），提出三個尚未實作
  的方案（景點搜尋改先試不限城市偏差、把 stop-suggestions 的搜尋中心對齊
  粗網格讓相近的「換一個」共用快取、`MOCK_PLACES` 環境變數在 fetch 層攔截
  Google 呼叫並用獨立 mock DB 避免污染 `dev.db` 真實快取）。

### 2. 追查 9/23 的 Places 費用，找到「開頁面就燒錢」的漏洞，並做完整份成本計畫（分支 `fix/places-enrich-rebilling`）

- 追查 9/23 的 136 元：`dev.db` 的每個版本（本機、9/23 和 9/28 的
  commit）都完全沒有 9/23 的快取寫入。對照 commit 紀錄推論是 Phase 3 的
  Playwright 端到端測試（`5cb34b0`，布拉格行程跑了兩次）：布拉格有 28 個
  餐廳、6 個住宿從沒 enrich 過，開頁面時自動 enrich，restructure 後再跑
  一次，dev 模式的 StrictMode 又讓每次都重複兩倍。明細無法精確還原，因為
  當天的寫入後來隨著 `dev.db` 被 git 還原而消失（commit 說布拉格改成 8
  天，現在的 `dev.db` 裡還是 7 天）。
- **找到兩個比測試放大點更嚴重的漏洞**：(1) enrich 查不到、或因為離城市
  太遠被擋掉的項目，既不寫快取、也不留紀錄，**每次打開行程頁都會付費
  重查**（里斯本、東京 seed 行程每次約 40 次）；而且開頁面時有 4 個來源
  同時在查同一個地點（`EditableItineraryCard` 和 `ItineraryMap` 各自
  enrich，再各乘上 StrictMode 的兩倍）。(2) `dev.db` 被 git 追蹤，切分支
  或放棄變更就會把付費查到的快取倒回舊版本。
- 修正（`plan/places-api-cost-reduction.md` 第 0 節）：
  - 失敗記號 `enrichFailure: { query, reason, at }` 存在 `days` JSON 裡，
    **以失敗時的查詢字串為準**、30 天內跳過——改名或換城市時查詢字串
    自然不同，會自動重查，不需要每條編輯路徑都記得清掉記號。三個
    enrich 路由都接上，有記號的項目也不再送去 OpenAI 翻譯。
  - `searchPlaceText` 做 in-flight 去重：同時的相同查詢共用一次 Google
    呼叫。選在最底層做，而不是原本構想的 enrich-all-stops 路由層，因為
    這樣四個來源一起擋得住，前端不用改。
  - `.gitignore` 加 `/prisma/dev.db*`；`git rm --cached` 由使用者執行。
- 同一個分支也把計畫原本的三項做完：加景點搜尋改成先查一次不限城市、
  不準才逐城市展開（最好 1 次，而且最壞情況也比舊版少一次）；
  stop-suggestions 的搜尋中心對齊 0.05° 網格讓附近的「換一個」共用快取
  （衛星小鎮維持原座標）；`npm run dev:mock` 讓所有 Google 呼叫走同一個
  `googleFetch()`，回傳格式跟真的一樣的假資料，原本的解析、快取、篩選
  程式照常執行。mock 模式強制使用獨立的 `mock.db`，指向 `dev.db` 時
  `db.ts` 載入就報錯，避免假地點被寫進真實快取。
- 驗證：新增單元測試（`enrichFailure`、`placesTextSearch` 去重、
  `places/search` 路由、`snapToGrid`、`mockPlaces`）和一個整合測試
  （第一次查詢並標記、第二次不打 Google、改名後重查），全部 187 + 5 個
  通過；實際啟動 `dev:mock` 確認搜尋回傳 `mock-` 地點、照片回 SVG、指向
  `dev.db` 時被擋下。會實際付費的手動驗證（里斯本開兩次、開羅搜獅身
  人面像、相近 stop 共用快取、Raszyn 衛星情境、mock 模式完整流程）由
  使用者在瀏覽器上逐項驗證通過。
- 移除 `dev.db` 追蹤後 CI 的 `npm run build` 失敗（`main.Itinerary` 不存在）：
  `/itineraries` 頁面在 build 時被靜態預先產生，過去一直讀 git 裡那份
  `dev.db`。這其實也是個既有 bug——正式版的行程清單會停在 build 當下的
  內容。加上 `export const dynamic = "force-dynamic"` 改成每次請求才查，
  用空資料庫重現 CI 情境確認 build 通過。
- 後續掃過其他可能多花錢的地方，追加兩件事：(1) 切回 `main` 再 pull 時，
  git 先把被 ignore 的本機 `dev.db` 換成舊版本、再隨刪除 commit 刪掉——
  這是移除追蹤時的一次性副作用，用 15:44 的備份復原（遺失手動驗證那段
  的寫入）；本機已只剩 `main`，之後只有直接 checkout 舊 commit 才會再觸發。
  (2) `getCityCenter` 查不到的城市同樣不快取、每次開頁面重查（例如把
  「富士山」當 `waypointCity`）——`PlaceQuery` 需要真的 placeId 放不進
  「查無結果」，所以比照 `NearestStationCache` 新增 `CityCenterMissCache`
  只記確認查不到的城市，API 錯誤不記。
- 教訓：快取表只記錄「查詢成功」的呼叫，所以**失敗的查詢是看不見的
  成本**——從資料庫反推費用時會漏掉，程式碼註解說的「冪等」也只對成功
  的項目成立。

### 今天的結論

- Phase 6 的範圍評估依然停在「只做無風險清理」，這次用真實批量資料把
  「還太早移除 fallback」的直覺，換成了兩個具體、可獨立處理的技術原因。
- Places API 成本這條線今天從「提出方案」一路做到「全部實作完」，而且
  途中發現真正的大漏洞不是測試時的放大點，而是「不做任何事、光開頁面就
  付費」的 enrich 重查。
- 下一步：`planTrip` 插入城市天數 bug、time_of_day/站點數量分配品質
  兩個問題的優先順序留給使用者決定；Places 成本修正已完成驗證，待
  commit 後 merge。

---

## 2026-09-29

### 1. 追查「規則引擎比純 LLM 生成還貴」的原因（分支 `fix/rule-engine-api-cost`）

- 起因：使用者感覺換成規則引擎後，每次生成的費用比舊的整段 LLM 生成還高。
  手邊沒有帳單數據，這次是從程式碼逐一列出規則引擎路徑的付費呼叫：
  - **fallback 兩邊都付費**：規則引擎失敗（Phase 6 批量測試 7/8 成功）時，
    已經打出的 Nearby／Routes／OpenAI 不會退，接著舊 LLM 流程再整段付一次。
  - **Routes 是新增的一整類付費呼叫**：舊流程生成時不算距離；規則引擎每天
    每段相鄰景點都打一次 Compute Route Matrix，transit 沒路線再補打一次
    driving，而且「沒路線」的結果不快取，每次生成都重打。
  - **Nearby 快取 key 含 `maxCount`**：同一城市的移動日、觀光日、返程日各自
    用不同數量查 `tourist_attraction`，一次生成最多付 3 次，行程天數一變
    快取也對不上。但 Nearby 是按請求計費、不是按筆數。
  - 最新的餐廳／住宿候選池每城市多 4 次 Nearby（價格篩選為空時最多 8 次）；
    field mask 含 `rating`／`priceLevel`，可能落在免費額度較小的 Enterprise SKU
    （待帳單 SKU 確認）。
- 這次先修兩個便宜、不改行為的點：
  - `fetchNearbyPlaceCandidates` 一律向 Google 抓 20 筆、存進快取、在本地切成
    呼叫端要的數量。key 格式不變，只把數量那格固定為 20，所以既有的
    20 筆快取仍然有效（避開 7/18 那種 key 一變整批失效）；其他數量的舊快取
    列會各重抓一次。
  - `getDistance` 把 Google 確認的 `ROUTE_NOT_FOUND` 以 `null` 寫進
    `DistanceCache`（30 天），HTTP 錯誤／例外／`status` 錯誤碼不寫，下次重試。
- 驗證：新增 `distanceMatrix.integration.test.ts`、
  `fetchCityRestaurants.integration.test.ts`（mock fetch，確認只打一次 Google）；
  單元 211/211、整合 11/11、`tsc`、ESLint 全過。沒有跑真實 API，實際省下
  多少要看之後的帳單。

### 2. 資安盤點與 Google API key 拆分

- 寫了一份資安強化計畫（威脅模型、現況盤點、分階段修補）。判斷這個專案
  最值錢的是付費 API 額度，所以優先順序是成本濫用防護 → 存取控制 →
  傳統 Web 漏洞。
- 盤點程式碼，找出存取控制、請求頻率限制、輸入驗證、錯誤訊息與安全標頭
  幾類待補強項目，列入分階段計畫，之後逐項開分支修補。
- 到 GCP Console 實際檢查後發現：`.env` 的 `GOOGLE_PLACES_API_KEY` 與
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` **是同一把 key**，Application restrictions
  為 None，API restrictions 是 Maps Platform 預設的 32 支——等於打包進前端、
  人人可見的 key 可以直接呼叫 Places／Routes。已處理：
  - 新建瀏覽器專用 key：Websites 限 `localhost:3000/*`、`localhost:3001/*`，
    只開 Maps JavaScript API。踩到一次 `RefererNotAllowedMapError`，原因是
    規則少了結尾 `*`，只放行首頁、子頁面被擋。
  - 原 key 改為伺服器專用：對照 `src/`、`scripts/` 只打
    `places.googleapis.com`、`routes.googleapis.com`，所以縮到只剩
    Places API (New)、Routes API。
  - 刪除未使用的 OAuth Client ID。
  - `.env` 從未進過 git 歷史（`git log --all -- .env` 為空）。
- 同時發現：9 月 Google 花費超出月預算數倍，預算警示有設但沒收到信。
  來源還沒查，可能跟上面規則引擎的額外呼叫有關，也要排除 key 被盜用。

### 今天的結論

- 規則引擎本身不一定比較貴，貴在 fallback 雙重付費、新增的 Routes 呼叫，
  以及快取 key 設計讓同一個查詢被拆成好幾次付費。
- 下一步：到 GCP Billing 依 SKU 確認 `Nearby Search`／`Compute Route Matrix`
  的增加時間點；可以考慮在 `googleFetch` 加計數器，用 `dev:mock` 數出一次
  生成的呼叫次數（Google 不花錢，OpenAI 仍是真的）。fallback 雙重付費要等
  規則引擎成功率提升才能處理。
- 資安方面，瀏覽器 key 外露且沒限制是當下最大的洞，已先在主控台擋住；
  程式層的修補照資安計畫分階段、各開獨立分支做。
- 下一步：Billing Reports 依 SKU／每日查超支來源；預算連結 Monitoring
  email 通知管道；設 Places／Routes 每日配額；OpenAI 設用量上限。

## 2026-10-02

### 1. 查出 9 月 Google 超支的來源：Text Search 被按 Enterprise 計費（分支 `fix/text-search-pro-tier`）

- 拿到 9 月的 GCP Billing 報表（依 SKU 拆分）。小計 3,029.19、稅金 151、總計
  3,180，乍看以為是美元，其實帳單幣別是**新台幣**（約 US$100）：
  - Text Search Enterprise：3,678 次 → 2,971.05（**98%**）
  - Place Details Photos：1,262 次 → 58.13
  - 其餘（Nearby Search Pro/Enterprise、Compute Route Matrix、Place Details
    Essentials、Text Search Pro、Dynamic Maps）全部在免費額度內，0 元。
- 怎麼確認是新台幣：用 Google 公布的美元單價反推，扣掉每月 1,000 次免費後
  Text Search Enterprise 2,678 × $35/千 = $93.7、Photos 262 × $7/千 = $1.83，
  兩項都對上同一個約 31.7 的匯率；稅金 151 剛好是 5% 營業稅。所以預算
  「$500」其實也是 NT$500。
- 修正 9/29 的猜測：當時懷疑規則引擎新增的 Nearby／Routes 呼叫是主因，報表
  顯示這兩類都還在免費額度內，真正的大宗是 Text Search。
- 成因：`placesTextSearch.ts` 的 field mask 含 `rating`、`priceLevel`。一個
  請求只要有任何 Enterprise 等級的欄位，整個請求就按 Enterprise 計費（每月
  免費 1,000 次）；拿掉之後落在 Pro（每月免費 5,000 次），9 月的 3,678 次
  會全部在免費額度內。
- 代價與取捨：
  - `priceLevel` 本來就沒存進快取，命中快取時一直都拿不到，估價會退回中間價，
    行為不變。
  - `rating`：之後透過 Text Search 新補的景點不會有星等；餐廳／住宿候選走
    Nearby Search，星等照常。
- 連帶修掉一個會被這次改動放大的 bug：`upsertPlace` 更新時寫
  `rating: data.rating ?? null`，Text Search 不再回評分後，每次 enrich 都會
  把 Nearby 存下來的評分清空。改成只有拿到新評分才更新；
  `scripts/enrich-all-itineraries.ts` 自己寫 DB 的邏輯也同步修。
- 驗證：新增單元測試鎖住 field mask 不含 Enterprise 欄位（避免之後又加回
  `rating`）、新增 `placeCache.integration.test.ts` 確認既有評分不會被蓋掉。
  單元 247/247、整合 13/13、`tsc`、ESLint 全過。沒有跑真實 API，實際效果
  要看 10 月帳單的 Text Search Enterprise 用量是否接近 0。
- 不是 key 被盜用：網站沒有公開部署，用量只集中在 Text Search 和照片，跟
  自己 enrich／搜尋地點的使用方式一致。

### 2. 補記：9/29 之後合併的資安修補

- PR #31：照片代理路由驗證 `name` 參數（格式＋placeId 必須一致）、圖片寬度
  收斂到固定幾種尺寸（避免同一張照片換寬度重複計費）、照片網址快取設上限。
- PR #32：行程天數上限 30 天、風格描述長度上限、各 API 欄位長度上限、
  `restructure` 每城／總天數上限、`/api/*` 請求 body 上限（`src/proxy.ts`）。

### 3. 主控台的成本上限（Phase 0）

- GCP：Places API 設每日配額，程式就算失控，Google 每天的花費也有上限。
- OpenAI：Project 設 spend limit；Allow models 只開 `gpt-4o-mini`——程式碼
  所有呼叫都是 `OPENAI_MODEL ?? "gpt-4o-mini"`，`.env` 沒設 `OPENAI_MODEL`，
  所以 key 外流也不能拿去打貴的模型。之後要換模型得先加進允許清單。
- 還沒做：預算連結 Monitoring email 通知管道（9 月的預算警示沒收到信）。

### 4. Rate limiting 與全站每日上限（PR #34，分支 `security/rate-limit`）

- `src/lib/rateLimit.ts`，在 `src/proxy.ts` 執行（路由跑之前就擋）：依
  「IP + 費用等級」做滑動視窗計數（sliding-window counter：每個 key 只存
  目前與上一個視窗的計數，沒有固定視窗在邊界的 2 倍突發）。被擋的請求不
  計入，超限回 429 + `Retry-After`。
  - 等級：generate（`generate-stream` 每天 30 次）、ai（每小時 60）、
    google（每分鐘 120）、photo（每分鐘 300）、其餘純 DB（每分鐘 300）。
  - 數字以「一個人正常用 + 餘裕」設：打開行程頁會對每個景點／每天各打一次
    enrich，Google 等級要容得下這個突發。
- `src/lib/dailyBudget.ts`：全站每日呼叫上限（Google 3,000、OpenAI 1,000），
  接在 `googleFetch` 和 OpenAI client 的自訂 `fetch` 這兩個所有呼叫都會經過
  的點。是防止換很多 IP 繞過 per-IP 限制的最後一道牆。超過時回假的 429，
  帶 `x-should-retry: false`（OpenAI SDK 預設會重試 429，這個 header 讓它
  不重試）。
- `generate-stream` 同一 IP 同時只能跑 1 條串流，串流結束時在 `finally`
  釋放；前端 `useStreamingGenerate` 對 429 顯示中文提示。
- 取捨：計數存在單一 server 的記憶體，適合 `next dev` 或單機部署；部署到
  serverless／多實例要換成共用儲存（Redis 等），`RateLimitStore` 介面不用改。
  `x-forwarded-for` 在沒有可信任 reverse proxy 時可偽造，靠全站上限兜底。
- 驗證：單元測試涵蓋分級對照、滑動視窗、Retry-After、LRU 淘汰、每日上限、
  併發閘。另外用 `dev:mock` 實測：計數器跨請求保留（剩餘 299→298→297）；
  對 `generate-stream` 送無效 body（在呼叫 OpenAI 前就回 400，不花錢），
  第 31 次回 429。

### 5. 剩下的路由補上 zod 驗證（PR #35，分支 `security/route-schemas`）

- `stops/[stopId]`（PATCH／DELETE）、`stops/reorder`、`stops/[stopId]/enrich`、
  `accommodation/enrich` 原本直接解構 `request.json()`。PATCH 最需要：它把
  欄位寫進行程 JSON，換地點時還寫進共用的 Place 快取，原本可以存進
  `lat: 500`、`rating: 99` 或物件當名稱。現在檢查型別與範圍（緯度 ±90、
  經度 ±180、評分 0–5、時長 0–1440 分、費用 ≥ 0、文字長度上限）。
- 先查前端實際送出的內容再寫 schema：清空數字輸入框會送 `null`、換地點的
  `placeId`／`rating` 可能是 `null`，都要允許。測試直接用前端的真實
  payload，確認能通過、壞資料在碰 DB 之前就被擋。壞掉的 JSON 改回 400
  （原本 500）。
- 用 `dev:mock` 手動確認編輯、換景點、拖曳排序、刪除都正常。

### 6. 排查「行程頁沒有圖、行程怪怪的」

- 結果是預期行為：那個行程在 `prisma/mock.db`（`dev.db` 沒有），也就是
  `dev:mock` 生成的，景點都是「Mock tourist_attraction N」，照片是 SVG
  佔位圖。查證方式：唯讀查兩個 DB 的資料、檢查 10 個景點的照片名稱都符合
  照片路由的新驗證，再用另開的 mock server 打照片路由確認回 200 + SVG。
- 踩到：使用者的 `next dev` 還開著時，第二個 `next dev` 會因為 `.next/dev/lock`
  無法啟動，同一個專案一次只能跑一個 dev server。

### 今天的結論

- 看帳單先確認幣別。這次差點把 NT$3,180 當成 US$3,180 處理。
- Google Places (New) 的計費是「整個請求按最高等級欄位算」，field mask
  多一個欄位就可能換到貴很多、免費額度也少很多的 SKU。新增欄位前要先查
  它屬於哪個等級。
- 資安計畫的 Phase 0、Phase 1 完成，「被別人拿去燒錢」這類風險大致擋住。
  Phase 1 只剩照片路由把 key 改放 header（要打一次真實 API 驗證）。
- Phase 2（存取控制）先暫停：網站還沒部署，目前沒有實際風險。部署前一定
  要做——現在任何人知道行程 id 就能刪改它。
- 下一步：預算連結 Monitoring email 通知；10 月帳單出來後確認 Text Search
  Enterprise 用量接近 0。

## 2026-10-03

延續資安計畫（`plan/security-hardening.md`）。第 1–4 點是 10/2 深夜做的，合併在 10/3。

### 1. 安全標頭（PR #37，Phase 4）

- `src/lib/securityHeaders.ts`（有單元測試）由 `next.config.ts` 的 `headers()`
  套到所有回應：`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、
  `Referrer-Policy`、`Permissions-Policy`（相機／麥克風／定位等全關，程式碼都
  沒用到）、production 才加 HSTS，並關掉 `X-Powered-By`。
- CSP 先用 **Report-Only**：允許清單照 Google 官方的 Maps JS CSP 指南，但漏掉
  任何網域都會讓地圖或照片直接壞掉，所以先只在 Console 回報、不阻擋，用一段
  時間沒有違規再設 `CSP_ENFORCE=1` 改成強制。
- Next.js 的 inline script 沒設 nonce，所以 `script-src` 還有
  `'unsafe-inline'`；之後要更嚴可以改用 nonce。

### 2. 錯誤訊息不再外洩（PR #38，Phase 4）

- 15 支路由出錯時原本回 `details: String(error)`（可能帶出 Prisma 錯誤、
  檔案路徑、上游 API 回應），而前端其實只有生成行程那裡會顯示 `details`。
- 改用 `src/lib/apiError.ts` 的 `internalErrorResponse()`：完整錯誤只寫進
  server log，回給前端的是通用訊息 + 8 碼 `requestId`，同一個 id 也印在 log，
  方便對照。`generate-stream` 串流裡的錯誤同樣改成 requestId，畫面顯示
  「（錯誤代碼 xxxx）」。
- 保留不改：zod 驗證錯誤（描述呼叫端自己送的欄位）、生成行程的驗證代碼
  （描述 AI 產出哪裡不合格）。
- 測試模擬 DB 拋出帶檔案路徑的錯誤，確認回應裡不會出現那些內容。

### 3. 提示注入（PR #39，Phase 3）

- 盤點 13 個 OpenAI 呼叫點，找到三處把使用者文字直接放進 **system prompt**：
  `tripPlan.ts` 的風格描述（最長 1000 字，影響最大）、新增景點時輸入的名稱、
  推薦景點的排除清單。system prompt 是模型最信任的位置。
- `src/lib/untrustedInput.ts`：使用者文字一律用 `<user_input>` 包起來放進
  user message，system prompt 附加一條規則（標記裡只是資料，要求改規則、改
  格式、透露系統說明一律不理）。包裝時移除輸入裡的 `</user_input>`，避免提早
  關掉標記。
- 決定不做：`max_tokens`（模型已限定 gpt-4o-mini，本身輸出上限約 16k tokens、
  單次約 US$0.01；設太小反而會截斷長行程的 JSON）、Moderation API（目前只有
  自己使用）。
- 標記包裝只能降低模型被帶偏的機率，不能保證；實際影響有限是因為沒有其他
  使用者的資料、輸出都經 zod 驗證並以純文字顯示。用 `dev:mock` 實際生成一次
  帶風格描述的行程，確認描述移到 user message 後仍被採用。

### 4. 依賴漏洞與 Next.js 升級（PR #40，Phase 5）

- `npm audit` 有 11 個漏洞（1 critical、7 high）。critical 在 Next.js 本身，
  其中一個是「Windows 上的 server 可被未驗證遠端執行程式碼」——開發機就是
  Windows，`next dev` 也會開在區網上。
- `next`、`eslint-config-next` 16.1.6 → 16.3.8（同一個主版本），其餘用
  `npm audit fix` 在原版本範圍內修掉 → 0 個。升級後測試、`tsc`、lint、
  production build 全過，`dev:mock` 實測頁面、安全標頭、rate limit 都正常。
- CI 早在 9/13 就有（lint、測試、build），這次加上
  `npm audit --omit=dev --audit-level=high`；新增 `.github/dependabot.yml`
  （npm 每週、minor/patch 合成一個 PR；GitHub Actions 每月）。
- 踩到：Next 16.3 的 `next dev` 每次都會在 repo 根目錄產生 `AGENTS.md`、
  `CLAUDE.md`，在 `next.config.ts` 設 `agentRules: false` 關掉。

### 5. GitHub 端的設定與 Dependabot 第一批 PR

- 開啟 CodeQL（Default setup）；`main` 設 ruleset：禁止刪除與 force push、
  必須透過 PR、CI（`ci`）通過才能合併，核准數設 0（一個人無法核准自己的
  PR），合併方式只留 Merge（跟既有歷史一致，也避免 squash 後本機
  `git branch -d` 判斷不出已合併）。
- Dependabot 第一次執行一口氣開了 7 個 PR：
  - 合併：minor/patch 群組（#43）、`actions/checkout` 4→7（#41）、
    `actions/setup-node` 4→7（#42），CI 都通過。
  - 不合併、留言 `@dependabot ignore this major version`：prisma 5→7、
    typescript 5.9→7、vitest 4→5，CI 都失敗，都是需要專門遷移的主版本。
  - 先保留：openai 6→7（#47）。CI 通過，但測試都把 OpenAI mock 掉了，而
    `openai.ts` 用自訂 `fetch` + `x-should-retry` 做全站每日上限，主版本升級
    要實際呼叫一次 API 確認這個機制還有效。
- 合併後 `npm audit` 又出現 5 個 high（`braces`，當天新公布），但只在
  lint 工具的依賴裡，會上線的依賴是 0 個，CI 照樣通過。npm 建議的修法是把
  `eslint-config-next` 降到 14 版，不採用，等上游修正後由 Dependabot 處理。

### 6. 首頁表單的偏好到底有沒有影響行程（`test/form-fidelity` 分支）

- 起因：不確定生成的行程有多符合表單的選擇。盤點後發現既有的檢查
  （`validateItinerary`、`validateGeography`、`batch-test-rule-engine`）只驗
  **結構**（天數、移動日、住宿），沒有一個在看「選了緊湊／經濟／美食、寫了
  不吃海鮮」有沒有反映在行程上。
- 決定分兩層：先寫免費的接線測試（mock 掉 OpenAI／Google，看每個欄位有沒有
  傳到該用它的地方），之後再寫付費的評分腳本量 LLM 實際遵守的程度。先做第一層，
  避免花錢量到的其實是已知的接線 bug。
- 新增 `assembleItineraryDays.test.ts`、`itineraryCityGen.pace.test.ts`。已知
  缺口用 `it.fails` 標記：測試寫的是應有行為、目前失敗但整套仍是綠燈，修好後
  vitest 會提示把它改回 `it`。結果 320 通過、6 個預期失敗。
- **有作用**：預算（景點、移動日、回程日、餐廳、住宿都有收到）、抵達時間、
  回程出發時間。
- **沒作用**（預設的規則引擎路徑）：
  - `assembleItineraryDays.ts` 寫死 `NEUTRAL_PREFERENCE_INTENT`，所以表單的
    步調、興趣都到不了每天的排程；`parsePreferenceIntent` 也沒被呼叫，自由文字
    只影響 `planTrip` 的城市天數分配。
  - 就算接上，每天景點數也固定是 `STOPS_PER_DAY = 4`：悠閒、緊湊都是 4 個，
    跟表單寫的「悠閒 ≤3、緊湊 5+」不符；步調只改了景點間的緩衝時間。
  - `generateMealsAndAccommodation` 沒有飲食限制參數，「不吃海鮮」無從過濾。
  - 人數整個 `src/` 沒人讀；興趣裡的「美食」「冒險戶外」在
    `INTEREST_CATEGORY_BOOST` 沒有對應類別。這兩項還沒定義應有行為，先不寫測試。
  - 中途停留城市只是接在 prompt 文字後面，遵不遵守要靠第二層的付費評分才量得到。

### 7. Phase 2 規劃：訪客試用 → 登入下載（PR #54）

- 重新討論 Phase 2 的方向：原本的選項是「整站密碼」或「Google 登入 + 白名單」，
  最後決定的產品流程是**訪客不用登入就能生成 1 個行程，想下載 PDF 才要用
  Google 登入**，訪客行程保留 3 天，登入時自動轉到帳號；另外做公開唯讀範例
  給面試官直接看。PDF 用瀏覽器列印（中文天生正常、不用處理字型）。
- 開放匿名使用代表任何人都能花錢，所以額度變成重點；「只限制會花錢的編輯」，
  拖曳、刪除、改文字這類只寫 DB 的操作不限制。
- 多開帳號沒辦法 100% 防止，目標改成「讓多開不划算，而且被繞過時每天的損失
  有上限」：全站每日總量、同 IP 共用、同裝置共用、新帳號額度較低、CAPTCHA、
  只用 Google 登入、可停用帳號。完整計畫在 `plan/access-control.md`。

### 8. 先量測一次生成的成本（PR #55）

- 新增 `src/lib/usageMeter.ts`：用 `AsyncLocalStorage` 在單一請求內計數
  `googleFetch` 與 OpenAI client 的呼叫，Google 連同 field mask 一起記（mask
  決定計費等級），mock 模式也計數，所以用 `dev:mock` 就能量、Google 不花錢。
- 首爾進、釜山出、6 天：快取沒命中時 Google 28 次（Nearby Search 12 次是
  Enterprise 計費）、OpenAI 10 次；同一個行程第二次 Google 只剩 1 次。換算
  超過免費額度後約 US$0.55／次，OpenAI 只有約 US$0.003。
- 這推翻了原本規劃的全站上限（每天 250 次，最壞約 US$137／天），改成上線初期
  每天合計 20 次。也發現 Nearby Search 跟 9 月的 Text Search 是同一個問題
  （欄位含 `rating`／`priceLevel`），列為待評估。

### 9. 登入、擁有權、訪客身分（PR #56–#58）

- **Google 登入**（Auth.js v5、JWT session，不需要新增資料表，跟之後的
  Postgres 遷移互不影響）。原本寫死的 `DEMO_USER_ID` 行程用一次性腳本轉給
  管理者帳號。
- **擁有權檢查**：`authorizeItinerary()` 套到 26 支路由。不是自己的、不存在、
  已過期一律回 404，讓人沒辦法用回應判斷某個 id 存不存在。用腳本稽核每一支
  路由，確認檢查發生在任何寫入、OpenAI、Google 呼叫之前（也發現 `MOCK_AI`
  分支排在檢查前面，一起移到後面）。整合測試用真的 SQLite：A 對 B 的行程做
  10 種操作全部 404 且資料不變。
- **訪客身分**：沒登入的人生成時建立 `isGuest` 使用者，cookie 值是
  `userId.HMAC(AUTH_SECRET)`，無法偽造或改成別人的 id。訪客行程 3 天後過期，
  過期的讀取時直接當作不存在；登入的那一刻把行程轉到帳號並刪掉訪客。
- 踩到：
  - `next-auth` 在 vitest 裡載入不了 `next/server`，改成在共用的
    `tests/setup/mockAuth.ts` mock 掉 `@/auth` 和 `next/headers`，測試用
    `signInAs()` 決定目前是誰。
  - 用 `JSON.stringify` 改 `tsconfig.json` 把整個檔案的排版都改掉了，還原後
    改成只動一行。
  - CI 的 lint 抓到元件在渲染時呼叫 `Date.now()`（React 的 purity 規則）。
    本機其實也會報錯，只是檢查時只看了 lint 輸出的最後兩行而漏看；之後一律看
    結束碼。
    修法是把「剩幾小時」改由 API 在伺服器端算好。

### 10. 使用額度與 CAPTCHA（PR #59、#60）

- **額度**（`src/lib/quota.ts`）：判斷邏輯是純函式（每一層各自有單元測試），
  計數從 `UsageEvent` 表讀，24 小時滾動視窗，server 重開也不會歸零。訪客 1 次、
  註冊每天 5 次（新帳號前 3 天 2 次）、會花錢的編輯另計；同 IP、同裝置
  （`proxy.ts` 發的 `device_id` cookie）跨帳號共用；全站每天訪客 5 + 註冊 15。
  IP 只存 HMAC 雜湊。額度在建立訪客、任何付費呼叫之前檢查，只在「真的會花錢」
  時計入（例如交通推薦命中快取不算）。
- **CAPTCHA**：Cloudflare Turnstile，生成前在伺服器端驗證；連不上 Cloudflare
  就拒絕，正式環境沒設 secret 也拒絕（避免忘記設定讓檢查形同虛設）。整合測試
  確認沒通過驗證時，不會建立訪客、不會記錄使用量、不會呼叫 OpenAI。
- 在瀏覽器裡用 `npm run dev` 以訪客身分實際生成一次，驗證框、token 傳遞、
  伺服器驗證、使用量記錄、3 天到期都正常。

### 今天的結論

- 資安計畫 Phase 0–5 的安全與成本部分全部完成：登入、擁有權、訪客、額度、
  CAPTCHA 都上線了。Phase 2 只剩兩個產品功能：列印成 PDF、公開範例。
- 「先量測再訂上限」：沒有量測之前寫的全站上限，最壞情況是預算的幾百倍。
- 「CI 通過」不等於「真的能用」：openai 升級的測試全部是 mock，碰到外部服務
  的主版本升級要另外實測；登入、CAPTCHA 這類要在瀏覽器裡跑的流程也一樣。
- 「行程通過驗證」也不等於「符合使用者的選擇」：表單上的步調、興趣、自由文字
  在主要生成路徑上目前都沒有作用。下一步是另開 `fix/form-preferences` 修接線，
  修完再寫付費評分腳本量 LLM 的遵守程度。
- 剩下的小項目：預算連結 Monitoring email、CSP 改成強制執行、照片路由把 key
  改放 header、openai 7 升級、Phase 5 的費用告警（呼叫記錄已由 `usageMeter`
  完成）、Nearby Search 要不要降到 Pro 欄位；部署時要設
  `AUTH_TRUST_HOST`、正式網域的 OAuth 與 Turnstile hostname、Turnstile 金鑰，
  並排程跑 `cleanup-expired-guests`。

## 2026-10-04

第 1、2 點是 10/3 深夜做的，合併在 10/4。

### 1. 下載 PDF：瀏覽器列印（PR #62）

- 行程頁的「下載 PDF」打開瀏覽器的列印視窗（另存為 PDF），搭配
  `globals.css` 的 `@media print`：隱藏所有按鈕與 `data-print-hidden`
  （帳號列、頁首、訪客提示、重新規劃面板），強制白底深色字——作業系統是
  深色模式時，`dark:` 樣式會在白紙上印出白字。
- 收合的天數根本不會被渲染（`!isCollapsed && …`），單靠 CSS 救不回來，所以
  列印前讓卡片 `expandAll`、切到列表檢視，`afterprint` 後復原。列印時頁面
  標題換成行程名稱，當作 PDF 的預設檔名。
- 訪客的按鈕顯示「登入後下載 PDF」，按下去導向 Google 登入（登入時行程會轉到
  帳號）。這是引導註冊，不是安全措施：內容本來就在畫面上。

### 2. 列印版面的修正（PR #63、#64）

- 實際印出來的 PDF **少了每一天的標題**：「第 N 天」是放在收合用的按鈕裡，
  而列印 CSS 隱藏了所有按鈕。PR #62 時只檢查了景點、餐廳名稱有沒有被包在
  按鈕裡，漏掉了天數標題。改成 `button:not([data-print-show])`，天數標題的
  按鈕標記保留，只隱藏裡面的收合箭頭。
- **第 3 頁以後沒有照片**：照片是 `loading="lazy"`，還沒捲到的根本沒載入。
  列印前把頁面上所有 lazy 圖片改成 eager，等它們載入完（最多 5 秒）才打開
  列印視窗。
- 一併隱藏拖曳把手、「跳到第 N 天」快捷列（按鈕隱藏後只剩空框）、「導航」與
  「在地圖上查看」連結、副標題的「可拖曳排序景點」。
- 踩到：PR #63 合併、GitHub 自動刪除遠端分支之後，又在同一個本機分支上
  commit 並 push，遠端分支被重新建立，畫面上出現一個「1 ahead / 1 behind」
  的分支，要另外開 PR #64。之後 PR 合併後就從最新的 `main` 開新分支。
- 都是在瀏覽器裡實際下載 PDF、逐頁檢查發現的；自動化測試看不到列印版面。

### 3. Dependabot 的主版本升級改用設定檔擋（PR #69）

- 上次用 `@dependabot ignore this major version` 擋掉的是 prisma 7、
  typescript 7，Dependabot 隔天改提中間的版本（prisma 6、typescript 6），
  另外還有 eslint 10、`@types/node` 26。留言只擋「那一個主版本」，擋不完。
- 改在 `.github/dependabot.yml` 用 `ignore` + `version-update:semver-major`：
  prisma／`@prisma/client`（兩個要一起升，等 Postgres 遷移時處理）、
  typescript、eslint（要等 `eslint-config-next` 支援）、`@types/node`（要跟
  實際執行的 Node 22 一致，不是最新的 26）、vitest。minor／patch 與安全性更新
  照常。`openai` 刻意不擋（#47 待實測後升級）。

### 4. 公開範例（PR #71）

- `Itinerary.isPublic`。讀取行程的 `GET itinerary/[id]` 改用新的
  `authorizeItineraryRead()`：擁有者完整存取，其他人（不論有沒有登入）只能讀
  公開的行程；**所有寫入路由沒改**，仍只有擁有者，所以公開行程不可能被別人
  修改。公開檢視不回傳 `generatedWith`（擁有者當初輸入的風格描述）。
- 只有管理者能把**自己的**行程設成公開（`PATCH itinerary/[id]`，一般擁有者
  回 403）。行程頁上管理者會看到「設為公開範例／取消公開」與複製連結。
- 公開檢視的唯讀畫面：卡片加 `data-readonly`，用 CSS 隱藏所有編輯按鈕（只留
  收合天數、跳到第 N 天），拖曳改用空的 sensor，不跑自動 enrich；地圖只畫
  已經有座標的點、不呼叫 enrich——否則別人打開範例會寫入擁有者的行程，也會
  花 Google 的錢。下載、垃圾桶、重新規劃面板都隱藏。
- 整合測試涵蓋每一條規則（沒登入與其他使用者都能讀、看不到風格描述、所有寫入
  與垃圾桶被擋且資料不變、一般擁有者不能公開、取消公開後恢復私人）；`dev:mock`
  實測公開前後的讀寫，沒有付費呼叫。

### 5. 餐廳排進每天的時間軸、候選剔除非餐飲（10/3，PR #51、#52）

- 使用者回饋希望餐廳跟景點放在一起看。餐廳改成穿插在每天的時間軸裡：早餐最前、
  午餐在第一個下午景點之前、點心和晚餐最後；原本的「餐廳推薦」四格拿掉。
  排序規則抽成 `src/lib/dayTimeline.ts`，地圖的路線也改用它，兩邊順序一致；
  「導航」連結照同樣順序經過餐廳。資料結構沒變，餐廳仍在 `day.meals`。
- 實際點「換一家」時，早餐候選出現新宿高島屋、TOHO 影城、LUMINE。追查原因：
  Nearby Search 的 `includedTypes` 只要地點的**任一個**類型符合就回傳，百貨、
  影城裡有咖啡店，`types` 裡就帶了 `cafe`。新增 `isFoodPlace()`，看 Google
  排在第一個的主要類型是不是餐飲類；直接套在已快取的結果上，不多花錢。
  用 `dev.db` 裡那筆真實快取驗證：20 筆剔除 8 筆。

### 6. 首頁表單與旅遊偏好重新設計（計畫定案）

- 原則：**表單上每個選項，都要對應到演算法做得到的事**。逐項檢查後發現：
  - 「人數」在 `src/` 裡完全沒被讀取。
  - **Nearby Search 根本不支援 `priceLevels`**（只有 Text Search 有），我們送的價位
    條件被直接忽略，但快取鍵值包含預算，所以同一個城市換個預算就重新付一次錢、
    拿到一模一樣的結果。用 `dev.db` 確認：杜拜「高端」的景點池跟沒有價位條件時
    完全相同，所有帶價位條件的結果也都沒有價位資料。
  - 「冒險戶外」「美食」在現在的候選池（只查 `tourist_attraction`）裡沒有東西可以
    加權。
- 跟使用者情境逐項討論後定案，寫在 `plan/form-preference-wiring.md`：
  - **步調改成看停留時間**：緊湊每個景點約 1.5 小時內、適中約 3 小時，依景點類型
    調整；每天景點數改成「排得下幾個就幾個」，不再固定 4 個。
  - **預算**：住宿分青旅／民宿與平價商務旅館／希爾頓萬豪等級；午晚餐優先推薦
    NT$400／1,000 以下、NT$1,000～2,000。用 Google 的 `priceRange`（跟現有欄位
    同一個計費級距）在本機排序，因為很多店沒有價格資料，所以是排序不是過濾。
  - **偏好擴充為 7 個**，加上飲品（咖啡、抹茶、酒）、室內行程為主、固定行程
    （演唱會等）、同行者（獨旅、親子、長輩、寵物）、交通方式（自駕）、國內／國外。
    分成 5 個實作階段。
- 設計上的判斷：
  - 親子、長輩、寵物、獨旅會**修改其他所有設定**（例如親子時不推薦酒吧），所以做成
    獨立的「同行者」，而不是跟美食、購物並列的偏好。
  - 咖啡、抹茶、酒是「吃」的時段（取代點心、晚餐後小酌），不是景點。
  - 演唱會的時間是固定的，跟拍攝地朝聖不同，所以做成通用的「固定行程」，把時段
    鎖住、其他行程繞著它排；球賽、表演、餐廳訂位也能用。
  - 每一項都先查 Google 官方的類型表和計費表，確認查得到、會不會變貴。
    「適合兒童」「可帶狗」「停車」屬於較貴的級距，只在選了對應選項時才要求。

### 7. 表單偏好接線：階段 1（PR #74）

- 10/3 用 `it.fails` 釘下的 6 個缺口全部修好：表單和自由文字合併成同一份偏好
  （`mergePreferenceIntent`，表單優先、清單取聯集），送到每天的排程。
- **步調改成看停留時間**（`assignTimeSlots` 每種步調一張表），每天景點數改成
  「排得下幾個就幾個」（`stopCapacity.ts`，上限 6 個）。實作時用 `dev.db` 的 529
  個景點驗證：地標、寺廟、觀景台佔 64%，原本的表（這些在適中只停 1 小時）會讓
  適中一天排 4～5 個、跟緊湊差不多，所以把地標類也拉長（計畫的選項 B）。
- **計費**：Nearby Search 拿掉被忽略的 `priceLevels`（修掉換預算就重複付費的
  bug），並依用途分開 field mask：景點、早餐點心、住宿走 Pro，只有午晚餐走
  Enterprise（要 `priceRange`）。Pro 查詢會先沿用同地點的 Enterprise 快取，
  `dev.db` 現有的快取不必重新付費。
- **預算**：午晚餐依 NT$ 門檻排序（`priceRange` 換算台幣，匯率用 open.er-api）；
  住宿依等級排序；早餐、點心合併成一次咖啡廳查詢；「換一家」的搜尋中心對齊
  約 1 公里的格線，相鄰幾天共用快取。
- **飲食限制**：素食、純素、清真另外查對應的餐廳類型（真的過濾），不吃海鮮、
  不吃牛剔除對應主要類型的店，全部也寫進 prompt；自由文字解析出的標籤只接受
  snake_case，避免夾帶指令進 system prompt。出門時間 07:30／09:00／11:00。
- 表單：步調、預算移到外層，人數拿掉。第一版每個按鈕塞兩行說明太擠，改成按鈕
  只放名稱、下方一行說明（沒選時顯示預設行為）。
- **真實 API 實測**（斯德哥爾摩 14 天）：Nearby Search Pro 3 次、Enterprise
  **1 次**，OpenAI 15 次約 US$0.004；`priceRange` 只有 30% 的餐廳有。同時發現
  早餐點心合併查詢後各只剩約 10 家、長行程不夠用（我造成的退步，PR 內修掉），
  以及長天數會把 20 個候選用完（列為之後處理）。
- CodeQL 抓到品牌比對組 RegExp 時跳脫不完整（常數清單，實際無風險），改成
  不組 RegExp 的整字比對。

### 8. 景點分數加入離住宿的距離（PR #75）

- 公式：評分 × 偏好加權 × 1 ÷ (1 + 距離 ÷ 3 公里)，距離從**住宿**算（使用者
  選的），每天的路線也從住宿出發。生成流程改成先選住宿、再排景點；景點池是
  Pro 計費沒有評分，所以「評分」用 Google 熱門排名換算的分數。
- 實測北海道時，選經濟實惠卻排到全日空皇冠假日酒店：住宿只「排序」不夠，AI
  不一定照順序挑。改成符合等級的有 3 間以上時只交給 AI 符合的。

### 9. 同一個機場來回可以繞一圈（PR #76）

- 北海道 7 天只推薦札幌附近的點，原因不在距離公式，而是 `planTrip` 規定「同一
  城市來回絕對只能有一個城市」，加上候選只查市中心 10 公里內。放寬成：可分配
  4 天以上可以繞一圈（頭尾都是入境城市、中途城鎮 3 小時車程內、最多 4 個城市），
  回傳後再查每個城鎮的座標，超過 250 公里就退回只待入境城市。
- 實測發現 AI 會主動排出合理的繞行（札幌 → 小樽 → 登別），但兩次都忘了繞回
  札幌，被我寫的檢查擋掉後整份退回舊流程。改成由程式補上回程（`closeLoop`），
  不要求重來。
- 繞一圈之後一連串浮現的問題（以前每個城市只經過一次，所以沒出現過），都在
  這個 PR 修掉：景點 `id` 直接用 placeId 導致重複（地圖報錯，也可能讓編輯功能
  改到錯的景點）、交通日沒排除去過的景點、回程日先取前 7 個熱門再剔除去過的
  結果常常是空的、交通日從來沒排過餐廳。
- 另外修掉一個會浪費錢的問題：瀏覽器在生成途中斷線時，寫入已關閉的串流會拋錯，
  路由誤判成新排程失敗，接著付費跑舊流程給沒人看。改成斷線後不再送資料、不退回
  舊流程，新排程照樣存檔。
- 怎麼判斷一份行程走的是哪條路：舊流程的景點會有 `district`、`orderIndex`
  欄位，停留時間也不在步調表裡；兩次「看起來不對」的行程都是這樣認出來的。

### 今天的結論

- Phase 2（存取控制）全部完成：登入、擁有權、訪客、額度、CAPTCHA、PDF、
  公開範例。整份資安計畫的主要項目都完成了，網站具備公開部署的條件。
- 列印版面、登入、CAPTCHA 這類「要在瀏覽器裡看」的功能，自動化測試看不出
  問題，一定要實際操作一次。這次列印的兩個 bug 都是逐頁看 PDF 才發現的。
- 用 CSS 統一隱藏按鈕（列印、唯讀都是）很省事，但前提是「按鈕只是控制項」；
  有內容放在按鈕裡時要明確標記保留。
- 下一步：部署（`plan/docker-and-ci.md`，部署前的設定清單在
  `plan/access-control.md`）。小項目：openai 7 升級、CSP 改強制執行、預算
  連結 Monitoring email、`@types/node` 改 `^22`、第 6 天時段標籤順序錯亂。
- 表單重新設計的計畫定案（`plan/form-preference-wiring.md`），階段 1 當天做完
  （#74），另外加上距離公式（#75）和環狀多城市（#76）。原本的待辦「Nearby Search
  是否降到 Pro」也定案並完成：每個城市的 Enterprise 查詢從 4～5 次減為 1 次。
- 全部 mock 的測試抓不到的問題，真實 API 跑一次就浮現：`priceRange` 覆蓋率只有
  30%、長行程候選用完、AI 忘記繞回入境城市、交通日沒有餐廳、瀏覽器斷線會觸發
  付費的舊流程。功能做完後用真實資料跑一兩次很值得，費用都在免費額度內。
- 下一步（表單）：長天數的候選補查、階段 2（主題日、市區偏好、飲品、室內行程、
  固定行程），以及用真實 API 跑多種情境的評分腳本。
- 「選項有沒有作用」要從資料流追到底，不能只看表單有沒有送出：人數、步調、
  價位條件都是送出了、但下游沒用或被 Google 忽略。

## 2026-10-06

第 1 點的程式是 10/4 深夜寫的，合併在 10/6。

### 1. 長天數的行程：候選不夠用（PR #78）

- 起因：斯德哥爾摩 14 天的實測，第 8 天起每天只剩 1 個景點、回程日沒有景點，
  後半段的餐廳是 AI 自己翻譯名字的重複店家（沒有 placeId），最後兩天沒有餐廳
  （AI 一次排 14 天份，回覆被截斷）。原因都是每種候選只有 20 個。
- **景點**：剩下的候選不夠排時，才多查一次不同類型（博物館、美術館、公園、古蹟、
  觀景台），Pro 計費、有快取，短天數不會觸發。觀光日、回程日、交通日都適用。
- **餐廳**：
  - 每次最多請 AI 挑 5 天份；某一段失敗也會用候選補上。
  - AI 沒挑、挑錯、或被截斷的餐點，一律用真實的店補上，不再保留 AI 編的名字。
  - 候選用完才重複，而且不排在同一天或相鄰兩天。取捨上選了「重複真實的店」而不是
    「多付 Enterprise 查詢找更多店」：待同一城市兩週回訪喜歡的店很常見，而且免費。
  - 重複的店在時間軸標「第 2 次・上次在第 X 天」；「換一家」清單裡其他天已經排過的店
    標「第 X 天晚餐已安排」並排到後面（標示而不是拿掉，候選可能本來就少）。
- **沖繩 14 天實測兩次**，第一次抓到四個問題，都修掉了：
  - 後段整天照抄第 1～3 天：候選用完後一律挑「最久以前用過的」，剛好是第 1 天整組。
    改成「用過次數最少的店」裡依天數和餐別輪流挑。
  - 程式補上的店跟餐別不搭（晚餐排到刨冰店、點心排到咖哩食堂）：依 Google 的主要
    類型過濾，午晚餐排除甜點、咖啡、麵包店，早餐點心排除一般餐廳。
  - 餐費 ¥501：Google 把「¥1,000 以下」寫成「¥1–1,000」，取中間值低估了，
    起始 ¥1 的區間改用上限估算。
  - 同一個景點排了兩次：Google 把沖繩戰跡國定公園列成兩個地點，同名的只留一個。
- 第二次實測發現還有一半在照抄、某家居酒屋 14 天出現 4 次：上一輪保留了「AI 挑的
  重複店只要隔 2 天就照用」，而後段分批時清單裡用過的店照原順序排，AI 就一直挑
  最前面的。改成只有沒用過的店才照 AI 的選擇，重複一律由程式依次數輪流決定。
  單元測試只模擬了「程式自己補的店」，抓不到「AI 自己挑的重複」，是實測才發現的。
- 抓不到的：有些店是 Google 自己標錯類型（溫泉旅館「石のゆ」被標成咖啡廳），
  只能讓使用者按「換一家」。

### 2. 當天公布的漏洞讓 CI 失敗（PR #79）

- `source-map-js` 當天公布高風險漏洞，它是 Next.js 和 Tailwind 透過 postcss 間接
  用到的，`npm audit --omit=dev` 也算進去，所有 PR 的 CI 都失敗。另開小分支
  `npm audit fix`（1.2.1 → 1.2.2，只改 lockfile）先合併，功能 PR 不混進套件更新。
- 踩到：在功能 PR 按「Re-run jobs」不會帶到新的 `main`，重新執行會沿用當初觸發時
  的合併結果。要關掉 PR 再打開（或 Update branch）觸發新的事件，CI 才會用最新的
  `main` 重新計算。

### 3. 評分腳本：表單選項到底有沒有改變行程（PR #81）

- `npm run eval-form-fidelity` 用真實 API 生成 10 個情境：東京對照組，以及只改一個
  選項的組（緊湊、悠閒、經濟實惠、高端奢華、文化歷史、自然景觀、素食、晚起），
  外加札幌出發的環狀多城市。每個情境跟對照組比，共 8 項檢查。
- 指標的計算（`evalMetrics.ts`）不呼叫任何 API，有單元測試；腳本只負責生成和存檔。
  結果存在 `eval-results/`（不進 git）。可以用 `--only=` 只跑一個情境，
  `--dry-run` 只列出會跑什麼。
- 第一輪 8 項過 7 項：步調、偏好、素食、晚起、環狀都有照表單走。沒過的是
  高端奢華的午晚餐，只有 0% 在預算內。

### 4. 評分找到的問題：預算與城市中心（PR #82）

- **高端餐廳**：Nearby Search 依熱門排序，池子裡幾乎都是拉麵、咖哩，又不支援價位
  篩選。改用 Text Search 另外查高價位餐廳（`EXPENSIVE`／`VERY_EXPENSIVE`），
  併入候選池。上限從 NT$2,000 放寬到 NT$3,000，因為東京的高級晚餐多半
  ¥10,000 起（約 NT$2,100）。結果：0% → 100%（平均 NT$2,010）。
- **城市中心點錯了**，看 JSON 才發現：
  - 「東京」對到東京都的幾何中心（杉並區），淺草、銀座都在景點範圍外。
  - 「Barcelona」對到台北一間叫「巴賽隆納俱樂部」的酒吧。
  - 沖繩、北海道是整個縣、道的中心（糸滿附近、上川的山區）。
  - 改成先用城市類型（`locality`）查；東京、沖繩、北海道直接用固定座標
    （東京車站、那霸、札幌）。快取前綴改版，舊的錯誤座標不再使用。
- **東京的住宿區依預算**（`stayAreas.ts`）：大部分旅客住新宿或淺草，不是東京車站
  旁的商業區。經濟實惠查淺草／上野，適中和未選查新宿，高端查銀座／丸之內；
  景點仍以東京車站為中心。因為景點依住宿距離排序，住哪一區也會影響整趟行程。
- **經濟實惠住進四星飯店**：中心點修好後，住宿換成淺草豪景飯店。原因有兩層：
  - 篩選只認青旅，數量不到 3 間就不篩，改成所有平價類型都算。
  - 但還是選到同一間：搜尋混了泛用的 `lodging` 類型，熱門前 20 間全是連鎖飯店，
    沒有平價住宿可篩。改成只查平價類型，不到 3 間（小鎮）才補查一般住宿並排在後面。
  - 結果：Sakura Hotel Nippori（日暮里），檢查通過。
- 每輪只重跑有問題的情境（`--only=`），一次約十幾次 gpt-4o-mini 和少量 Places
  查詢，大部分命中快取。
- 還沒處理：每天景點偏少（`DAY_TOO_FEW_STOPS`，修改前就有）；同一地點被拆成兩個
  景點（淺草寺和淺草寺 雷門）。這兩項在下一段處理。

### 5. 每天景點偏少與重複地點（PR #84，10/7 合併）

- **找原因的方法**：用 `dev.db` 快取裡東京的 20 個真實景點，在本機重跑排程。
  排程的程式不呼叫 API，所以重跑不花錢，而且結果和評分裡的行程一模一樣，
  就能逐分鐘看到景點在哪裡被浪費。
- **原因 1：午餐固定在 12:00～13:00**。只要景點會碰到這個時段，就整個延到
  13:00 才開始：
  - 從 10:00 出發的那天，3 小時的博物館被延到 13:00，整個上午空著。
  - 後面的景點因此超過 18:00 被刪掉，那天只剩 1 個景點。
  - 改成彈性的 1 小時，可以在 11:00～14:00 之間開始：景點在 12:00 前開始、14:00 前
    結束，就排在午餐前；否則先吃午餐。11:00 這個下限是因為晚起的人可能 11 點才吃
    第一餐。
  - 午餐前的景點一定在 12:00 前開始，時間軸（依早上／下午放午餐）的位置才會對。
- **原因 2：只合併名字完全相同的地點**，「淺草寺」和「淺草寺 雷門」被分到不同天，
  各占半天。
  - 掃了快取裡所有「名字開頭相同」的組合才決定做法：同樣的條件會把倫敦塔和倫敦塔橋
    （298m）配成一組，但兩個是不同的熱門景點，直接合併會誤刪倫敦塔橋。
  - 所以不刪，改成整組排在同一天、前後相連（相距 500m 內才算一組；嵐山竹林小徑離
    嵐山 917m，不算）。
- **回程日的警告**：剩下的 `DAY_TOO_FEW_STOPS`、`STOPS_ALL_SAME_TIME` 都在回程日，
  而回程日只有搭機前的早上可排。生成流程和種子腳本原本就各自排除最後一天，
  改成由驗證本身略過。
- **結果**：
  - 本機重跑：適中・經濟實惠 3 個觀光日從 1／2／3 個變成 2／3／3 個；悠閒 5 → 6 個；
    緊湊 17 → 18 個。
  - 真實 API 跑 5 個東京情境（`--only=`，約 75 次 gpt-4o-mini）：步調（6.0 > 2.7 >
    2.0 個）、經濟實惠、晚起三項都通過，每個觀光日都至少 2 個景點。
- 還沒處理：
  - 新宿黃金街是酒吧街，但被 Google 標成景點，可能被排在早上。
  - 同一組的兩個地點各自用完整的停留時間（淺草寺 2 小時、雷門 2 小時）。

### 今天的結論

- 表單重新設計計畫的階段 1 和長天數問題都處理完了，評分腳本也做好；第一輪沒過
  的預算項目，以及每天景點偏少、重複地點，修完後重跑相關情境都通過了（還沒有
  重跑完整 10 個情境）。下一步：階段 2（主題日、市區偏好、飲品、室內行程、固定
  行程，可以沿用這次的「候選不夠時補查」）。
- 排程的程式不呼叫 API，所以可以用快取的真實資料在本機重跑，免費又能逐分鐘看到
  時間花在哪裡。先在本機重現評分結果、確認原因，再改程式。
- 評分腳本的通過與否只是起點，打開 JSON 看實際的店名、飯店和座標才找到真正的
  原因：城市中心點錯誤、住宿搜尋類型太廣，都不是檢查項目本身會直接顯示的。
- AI 不一定照清單順序或規則挑（住宿等級、繞回入境城市、重複的店都發生過）。
  重要的規則要由程式在 AI 回答之後強制執行，不能只寫在提示詞裡。

## 2026-10-07

### 1. 完整重跑 10 個情境：偏好沒有作用

- 前一天的修正（#82、#84）之後，第一次完整重跑 10 個情境：8 項過 6 項。步調、
  經濟實惠、高端奢華、素食、晚起、札幌環狀都通過。
- 沒過的是「文化歷史」和「自然景觀」：兩組排出來的 8 個景點和對照組幾乎一樣，
  比例都是 63%／38%。
- 第一輪（10/6）這兩項有通過，是因為那時東京的中心點錯在杉並區，候選景點比較
  分散。把住宿改到新宿之後，問題才浮現：修好一個 bug，讓另一個 bug 露了出來。
- 另外看到但沒處理：小樽的「小樽堺町通商店街」和「Sakaimachi Hondori Street」是
  同一條街的中英文名字，名字開頭不同，抓不到；小樽運河排在交通日、遊覽船排在
  第 5 天，因為交通日和觀光日用不同的候選。

### 2. 每天的景點也依偏好挑（PR #86）

- 原因：每天的第一個景點依「評分 × 偏好 × 離住宿的距離」挑，但其餘景點只挑
  **離第一個景點最近的**，完全不看偏好。住新宿時，最近的 8 個點不管選什麼都一樣。
- 改成其餘景點也用同一套分數，只是距離從第一個景點算，一天仍集中在同一區。
- 用快取在本機比較了三種做法：
  - 只看距離（原本）：三組都是 63%／38%。
  - 也看偏好、加權 1.5 倍：文化組 88%、自然組 63%，一天內景點最遠約 4～5 km。
  - 加權提高到 2 或 3 倍：差異沒有更明顯，一天反而更分散（最遠 8 km）。
  - 選了 1.5 倍。取捨是有選偏好時，每天大約多搭一兩站地鐵。
- 真實 API 重跑：文化組 86%（自然組 38%）、自然組 63%（文化組 14%），兩項都通過；
  沒選偏好的對照組景點完全不變。

### 3. 最後一個景點可以超過 18:00 30 分鐘（PR #87）

- #86 的評分裡，文化組第 3 天只有 2 個點。用那趟實際的住宿在本機重跑：
  東京國立博物館排到 15:15～18:15，超過 18:00 15 分鐘，整個被刪掉。
- 原因：每天排幾個景點，是用候選的平均停留時間估算的；選了文化歷史會挑到比較多
  3 小時的博物館，實際時間就超過估算。
- 動手前先量：快取裡 18 個城市 × 3 種步調 × 3 種出門時間 × 3 種偏好，原本被刪的
  56 個景點，寬限 30 分鐘能救回 46 個，總景點數只多約 1%，步調之間的差距不受影響。
  超時的大多在 15 分鐘以內，所以 30 分鐘就夠。
- 只放寬「刪掉超時景點」這一步；估算景點數和分散空檔仍以 18:00 為目標。
  回程日不適用，它的截止時間由班機決定。
- 量的時候發現：悠閒加晚起（11:00 出門）有些天只有 1 個點（每個點停 3～3.5 小時）。
  這是規則算出來的結果，只會有警告、不會觸發付費重試；要不要調整是產品規則的
  問題，先記下來。

### 4. PR 說明改用英文

- 從 #86 起，PR 標題和說明用英文寫，和 commit、程式碼註解一致，作品集的讀者都
  看得懂；地名和中文介面文字照原文。舊的 PR 不改，`docs/process.md` 維持中文。

### 今天的結論

- 完整 10 個情境在 #82、#84 之後跑了一次，偏好兩項沒過；修完（#86、#87）後重跑
  受影響的情境都通過了。表單選項目前都有照預期影響行程。
- 一次修一個問題，要記得回頭跑完整的情境：中心點修好後，偏好的問題才顯露出來，
  只跑「有問題的那幾組」會漏掉。
- 改規則前先用快取量影響範圍（救回幾個、多排幾個、步調會不會混在一起），
  比只看一個例子可靠，也不花錢。
- 下一步：階段 2（主題日、市區偏好、飲品、室內行程、固定行程）。

## 2026-10-08

### 1. 階段 2 拆成 4 個 PR

- 計畫的階段 2 有五個部分（主題日、市區偏好、飲品、室內行程、固定行程），一次做太大，
  拆成 2a 主題日、2b 飲品、2c 室內行程、2d 固定行程，依序做。先做 2a，因為評分腳本
  已經有文化、自然的檢查，做完可以直接驗證。
- 2a 的三個決定：
  - 表單偏好維持現在 5 個，只有美食、文化歷史、自然景觀、購物有主題日；「冒險戶外」
    到階段 3 再換成水上、陸上活動，不放還沒有作用的選項。
  - 只選 1 個偏好時，每個觀光日都是那個主題。
  - 每天約三分之一保留熱門景點（6 個點 → 2 個，3 → 1，2 → 1）。

### 2. 每個觀光日一個主題（PR #89）

- 原本偏好只是 1.5 倍加權，候選仍是同一個 20 個點的熱門景點池，博物館很少。
  現在每個主題各查一個自己的景點池（每個城市多 1 次 Nearby Search，Pro 計費，
  快取 30 天；沒選偏好就不多查）。
- 主題逐日輪流，跨城市延續，多城市行程不會每到一個城市就從第一個主題開始。
  標題寫出主題，例如「東京 文化巡禮」；那天一個主題景點都沒排到時維持「東京 探索」。
- 主題景點不夠時用剩下的景點補，不會因此少排。
- 文化主題不查寺廟、神社（會查到大量社區小神社），但熱門景點裡的寺廟、神社、城堡算文化。
- 交通日、回程日沒有主題，沿用 1.5 倍加權。
- 新的 Google 類型補上停留時間。踩到一個：觀景台（晴空塔之類）的類型裡也有
  `art_gallery`，把藝廊直接歸成博物館，現有測試就失敗了，所以藝廊的判斷順序放到最後。
- 評分腳本加了「文化＋自然」情境和兩項檢查（只選文化時每天都是文化巡禮；兩個主題輪流）。

### 3. 評分抓到：主題池讓每天的景點變少

- 第一次跑，四項主題檢查都通過，但文化組每天只有 2.0 個景點（對照組 2.67），
  第 1 天只有明治神宮和澀谷十字路口，15:00 就結束。
- 用快取的主題池在本機重跑，結果和評分一模一樣，找到原因：每天排幾個點是用候選的
  平均停留時間估算的，文化池多了約 20 間 3 小時的博物館，估算降成每天 2 個；
  但住宿附近實際挑到的多半是 2 小時的點。
- 改成只用熱門景點池估算（和加主題前一樣）。比估算長的一天，原本「超過 18:30 就刪」
  的規則會處理。重跑：文化組回到 2.67 個，多排到國立新美術館、東京國立博物館，
  文化類比例 88%（自然組 25%）。
- 檢查通過不代表沒問題：四項都過的那一輪，打開 JSON 才看到每天景點變少。

### 今天的結論

- 階段 2a 完成：選了偏好，每天有自己的主題和景點池，標題也寫得出來。
- 加新的候選來源時，要注意它會不會改變其他依「整個候選池」計算的東西（這次是每天的
  景點數估算）。
- 還沒處理：
  - 購物、美食主題沒有評分情境。
  - 主題池以城市中心查詢，景點又依離住宿的距離評分，離住宿遠的主題景點（住新宿時的
    上野博物館）比較少被排到。
  - 新宿黃金街是酒吧街，可能被排在早上。
- 下一步：2b 飲品（咖啡、抹茶取代點心時段，酒新增「小酌」時段）。

## 2026-10-09

### 1. 飲品再拆成兩個 PR，以及連鎖店的決定

- 2b 飲品裡，「酒」要新增晚餐後的「小酌」時段，前後端都要改（時間軸、換一家、
  重新產生的 API、費用、評分）；咖啡和茶只換掉點心時段。所以再拆成 2b-1 咖啡、茶
  和 2b-2 酒，先做 2b-1。
- 連鎖店：只排除到處都有的國際連鎖（星巴克、麥當勞、Costa 等，加上台灣的路易莎、
  85度C，出國喝這些不算體驗當地）；星巴克的臻選烘焙工坊本身是景點，例外保留。
  當地連鎖（Komeda、Doutor、星乃珈琲等）保留，因為有人會特地去體驗，但同一品牌只
  推薦一次，不同分店也算同一個。
- 評分門檻 3.5：日本的 Google 評分普遍偏低，很多好店在 3.5～4.0 之間。

### 2. 咖啡、茶取代點心時段（PR #91）

- 表單「更多選項」新增「飲品」：咖啡、抹茶／茶。
- **查詢方式跟計畫不同**：計畫寫 Nearby Search 加文字搜尋，但 Nearby 不能依評分過濾，
  Pro 計費又拿不到評分。改成每種飲品每個城市只查一次 Text Search（「specialty coffee」
  「matcha」），用 `minRating` 讓 Google 在伺服器端過濾，維持 Pro 計費，也比較省。
- 兩種都選時點心每天輪流，由程式在 AI 挑完後強制；那天的飲品店用完才改用一般點心。
  選咖啡時，早餐也優先推薦咖啡店。
- 小重構：比對品牌名稱的程式原本寫在高端住宿裡，抽成共用的 `brandMatch.ts`。
- 省錢：Text Search 確認「找不到」（例如小鎮沒有抹茶店）的結果也記進快取，
  查詢失敗的則不記，照專案「記住 miss、不記失敗」的原則。
- 寫測試時預期第 1 天的點心是某間咖啡店，結果是另一間：那間當天早上已被排成早餐
  （咖啡店也排在早餐最前面）。程式是對的，測試改成檢查「咖啡、茶」的順序。

### 3. 評分抓到：被程式換上的點心沒有介紹

- 第一次評分兩項檢查都通過（咖啡組全是精品咖啡店、沒有國際連鎖；兩種都選時輪流），
  但打開 JSON 才看到咖啡組 4 天的點心全部沒有介紹文字。
- 原因：提示詞完全沒提到旅客選了飲品，AI 挑了一般甜點店，程式依規則全換成咖啡店，
  換上的店沒有 AI 寫的介紹。
- 改成在提示詞列出每天要從哪幾個候選挑（「第 1 天：S1、S3；第 2 天：S2、S4」）。
  重跑：咖啡組 4 天都有介紹；咖啡＋抹茶組還有 2 天缺，因為咖啡店同時在早餐和點心
  清單最前面，AI 有時把同一間選成早餐又選成點心，被程式換掉。

### 今天的結論

- 階段 2b-1 完成：選了咖啡或茶，點心和早餐都會換成對應的店。
- 程式強制規則（輪流、不重複）的副作用是被換上的店沒有介紹；要讓 AI 一開始就照
  規則挑，提示詞要把規則寫成它照得到的形式（直接列候選編號），不能只靠事後修正。
- 還沒處理：
  - 程式補上的餐點沒有介紹（不只飲品），可以依店的類型寫一句通用介紹。
  - 購物、美食主題沒有評分情境；新宿黃金街可能被排在早上。
- 下一步：2b-2 酒（晚餐後新增「小酌」時段）。

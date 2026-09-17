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

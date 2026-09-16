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

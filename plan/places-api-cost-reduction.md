# Places API 測試成本降低計畫

> 建立日期：2026-09-28
> 起因：追查 9/17、9/18、9/23 的 Places 費用（見下方「背景」）

---

## 背景

9/17、9/18 的 Places 呼叫主要花在兩件事：一是用 UI 生成新城市行程後的 enrich（華沙/克拉科夫約 56 次、開羅約 82 次 Text Search），二是開羅行程上反覆測「換一批」和「加景點」。前者是正常成本（新城市本來就要查一次，之後會命中快取）；後者則暴露了兩個「同一個使用者動作打出好幾倍呼叫」的放大點，再加上一個結構性問題：**目前沒有辦法在不付費的情況下測主流程**。

從 `dev.db` 快取寫入紀錄反推（只算得到「沒命中快取且查詢成功」的呼叫，實際只會更多）：

| 日期（台灣時間） | Text Search 新寫入 | Nearby 新寫入 | 主要來源 |
|---|---|---|---|
| 9/17 21:58–23:56 | 58 | 16 | 華沙/克拉科夫 UI 生成的 enrich；Phase 3–5 真實資料驗證 |
| 9/18 20:25–20:47 | 93 | 18 | 開羅 enrich；開羅/吉薩「換一批」12 次 Nearby；加景點搜尋每個詞打 2–3 次 |

之後追查 9/23 的 136 元時，又發現兩個更嚴重的問題：**不用做任何測試，光是打開行程頁就會花錢**，而且付費查到的結果還可能被 git 倒回去。當天是 Phase 3 的 Playwright 端到端測試（`5cb34b0`，布拉格行程跑了兩次）：布拉格有 28 個餐廳、6 個住宿從沒 enrich 過，開頁面時自動 enrich，restructure 後再 enrich 一次，dev 模式的 StrictMode 又讓每次都重複兩倍。9/23 當天的所有寫入後來都隨著 `dev.db` 被還原而消失（commit 說布拉格改成 8 天，現在的 `dev.db` 裡還是 7 天），所以只能從 commit 紀錄推論，無法從資料庫精確還原。

本計畫處理的事項彼此獨立，各開一個分支：

- **第 0 節（最優先）：開頁面就會燒錢**
  - 0-1. enrich 查不到或被擋掉的項目沒有記錄，每次開頁面都重查
  - 0-2. enrich 請求重複送出（StrictMode、重新抓資料）
  - 0-3. `dev.db` 被 git 追蹤，快取會隨切分支、還原而倒退
- **第 1–3 節：測試時的放大點**
  1. `places/search` 的 attraction-search：對每個候選城市各打一次 Text Search
  2. `stop-suggestions`：每換一個錨點就要 4 種 type 各打一次 Nearby
  3. `MOCK_PLACES`：讓 UI 流程測試可以完全不打 Google

建議順序：0-3 → 0-1 → 0-2 → 1 → 2 → 3。0-3 只是 git 操作，最快、而且能避免後面修的過程中快取又被倒掉；0-1 省最多錢。

---

## 0. 開頁面就會燒錢（最優先）

### 0-1. 記住查詢失敗的項目

#### 現況

[`EditableItineraryCard.tsx`](../src/components/EditableItineraryCard.tsx) 每次拿到行程資料（開頁面、restructure 後重新抓取）都會自動：

- 呼叫 [`enrich-all-stops`](../src/app/api/v1/itinerary/[id]/enrich-all-stops/route.ts)：處理所有沒有 `placeId` 的 stop 和餐廳
- 對每個住宿沒有 `placeId` 的天呼叫 [`accommodation/enrich`](../src/app/api/v1/days/[dayId]/accommodation/enrich/route.ts)

程式碼註解說這是冪等的（「只會做新的工作」），但只對**成功**的項目成立。下面三種情況既不寫快取、也不在項目上留任何紀錄，所以每次開頁面都會再付費查一次：

| 情況 | 位置 |
|---|---|
| `searchPlaceText` 回傳 `null`（查不到） | enrich-all-stops 的 stop、餐廳；accommodation/enrich（回 404） |
| 查到了，但離城市中心太遠被擋掉（9/23 新增的餐廳距離檢查） | enrich-all-stops 的餐廳 |
| 快取裡的地點離城市太遠被擋掉 | enrich-all-stops 的餐廳（不花錢，但也不會留紀錄） |

目前 `dev.db` 裡每次開頁面都會重查的量：里斯本行程 11 個 stop、12 個餐廳、3 個住宿（含「前往巴塞隆納」「晚餐」這種**永遠查不到**的名字）；東京 seed 行程 9 個 stop、8 個餐廳、1 個住宿。

#### 設計

- （已實作）stop、餐廳、住宿物件上加 `enrichFailure: { query, reason: "not_found" | "too_far", at }`，存在 `days` JSON 裡，不改 Prisma schema。邏輯在 [`src/lib/enrichFailure.ts`](../src/lib/enrichFailure.ts)
- 記號以**失敗時的查詢字串**為準：只有目前的查詢字串跟記錄的一樣、而且在 30 天內（跟快取 TTL 一致）才跳過。使用者改名、換城市時查詢字串自然不同，會自動重查，不需要每條編輯路徑都記得清掉記號
- 三個路由都接上了：`enrich-all-stops`（stop、餐廳）、`stops/[stopId]/enrich`、`accommodation/enrich`。成功時清掉記號
- 被距離檢查擋掉的餐廳，之後跳過時仍然會出現在警告清單裡（不花錢），使用者看到的行為跟第一次一樣
- 有有效記號的項目也不送去 `translatePlaceNames` 翻譯，避免每次開頁面都付一次 OpenAI 的錢

**不建議**把失敗寫進 `PlaceQuery` 快取：那張表的 `placeId` 是必填、指向 `Place`，硬塞「查無結果」會影響所有讀快取的路徑。

#### 驗收

- （已完成）單元測試 `enrichFailure.test.ts`；整合測試 `enrich-failure.integration.test.ts`：第一次查詢並標記、第二次不打 Google、改名後重查
- （已完成，使用者驗證）手動：開里斯本行程兩次，第二次 server log 裡沒有 Text Search 呼叫。第一次會實際付費查一輪

### 0-2. enrich 請求去重

#### 現況

- Next.js App Router 在 dev 模式預設開啟 React StrictMode（`next.config` 沒有另外設定），effect 在 mount 時會執行兩次。兩個 enrich-all-stops 請求**同時**送出、都查不到快取，同一個地點就付兩次錢
- `data.data` 每次重新抓取都會觸發 effect 重跑。成功的項目會被跳過，但搭配 0-1 的問題，失敗的項目每次都會再查
- 住宿 enrich 是逐天呼叫，一樣會被 StrictMode 重複

#### 設計（已實作，跟最初構想不同）

- 最初構想是在 enrich-all-stops 路由層做去重。實作前發現打開行程頁時其實有**四個**來源同時在查：`EditableItineraryCard` 的 enrich-all-stops 和 accommodation/enrich，以及 `ItineraryMap` 各自逐筆呼叫的 `stops/[stopId]/enrich` 和 accommodation/enrich，再乘上 StrictMode 的兩倍。一個查不到的 stop 每開一次頁面最多會被查 4 次
- 所以改在最底層的 `searchPlaceText()`（[`placesTextSearch.ts`](../src/lib/placesTextSearch.ts)）做 in-flight 去重：參數相同（查詢字串、bias、type）、而且同時在跑的請求共用同一個 Google 呼叫。Map 存在 `globalThis`（比照 `db.ts` 的 Prisma client），dev HMR 重新載入時不會遺失
- 只合併「同時」的請求；前後依序的重複查詢交給快取和 0-1 的失敗記號處理
- 前端的四個呼叫點沒有改，重複請求仍然會送到伺服器，但不會再重複打 Google

#### 驗收

- （已完成）單元測試 `placesTextSearch.test.ts`：同時的相同請求只打一次、參數不同不合併、結束後會重新打、失敗後會釋放
- （已完成，使用者驗證）手動：dev 模式下開一個有未 enrich 項目的行程，同一個查詢只出現一次 Text Search

### 0-3. `dev.db` 不再給 git 追蹤

#### 現況

- `prisma/dev.db` 有被 git 追蹤（`test.db` 已經在 `.gitignore`，`dev.db` 沒有）
- 切分支、pull，或在 GitHub Desktop 放棄變更時，`dev.db` 會被換成某個 commit 裡的版本，**之後付費寫入的快取全部消失**，下次同樣的查詢要再付一次錢。9/23 的寫入就是這樣消失的
- 快取資料本來就是本機狀態，不適合進版控；每次 commit 都帶一個 2MB 的二進位檔，也讓 diff 沒辦法看

#### 做法（由使用者執行 git 操作）

- `.gitignore` 加上 `/prisma/dev.db*`
- `git rm --cached prisma/dev.db`，檔案留在本機，只是不再追蹤
- **影響**：之後 clone 下來的環境不會附帶資料，要自己跑 `npx prisma db push` 加 `npm run seed` 建立資料（seed 會打 OpenAI 和 Places）。README 的安裝步驟要補上這段
- 執行前先把目前的 `dev.db` 複製一份備份

#### 驗收

- 切換分支後 `dev.db` 不變（`PlaceQuery` 筆數一樣）

---

## 1. attraction-search：從「每城市一次」改成「先試一次，不行再展開」

### 現況

[`places/search/route.ts`](../src/app/api/v1/places/search/route.ts) 的 `resolvePlace()` 在 attraction-search 模式（有 `candidateCities`）下：

- 對**每個**候選城市做一次有 locationBias 的 Text Search（`Promise.all` 並行），取離自己偏向城市最近的結果
- 全部都沒結果時，再加一次無偏向的搜尋
- 所以一個 N 城市行程，每搜尋一個新詞要花 **N 次，最壞 N+1 次**。9/18 開羅+西奈半島（N=2）測 5 個詞，打了約 8 次

之所以每個城市都偏向一次，是為了避免無偏向搜尋的「唯一最佳結果」落到別的城市的同名地點（註解裡的例子：東京行程搜出台北的同名景點）。

### 選項

| 選項 | 做法 | 花費（N 城市） | 風險 |
|---|---|---|---|
| **A. 先無偏向，不合理再展開（建議）** | 先打一次無偏向 Text Search；結果如果在任一候選城市中心 `NEAREST_CITY_KM_THRESHOLD`（80km）內，直接採用；否則才走現行的逐城市偏向搜尋 | 最好 1 次，最壞 N+1 次 | 無偏向搜尋遇到有同名地點的詞時會多花 1 次（但會被距離檢查擋下、回到現行路徑，不會選錯） |
| B. 單次矩形偏向 | 用涵蓋所有候選城市的 `locationBias.rectangle` 只打一次 | 固定 1 次 | 城市相距很遠時（例如東京+雪梨）矩形大到偏向幾乎沒效果，等於退化成無偏向，同名誤判的問題又回來 |
| C. 依序偏向、提早結束 | 逐城市依序搜尋，結果離該城市夠近就停 | 最好 1 次，最壞 N 次 | 失去並行，城市多時延遲變長；而且城市順序會影響結果 |

**建議 A**：知名景點（金字塔、獅身人面像、清水寺）幾乎都是一次命中，這正是最常見的使用情境；有歧義的詞則回到現行邏輯，行為跟現在完全一樣。

### 實作要點

- 無偏向那次沿用既有的 `attraction-search:unbiased:${query}` 快取 key，跟現行 fallback 共用快取
- 距離判斷直接重用 `nearestCity()`：它本來就在 route 後段會跑一次，而且城市中心有快取，不會多花錢。可以把結果往前傳，避免算兩次
- 前端 `RestructurePanel` 的城市 entry 已經有 `lat`/`lng`，可以考慮順便傳給後端省掉 `getCityCenter` 查詢；但那些查詢本來就有快取，效益小，**不在這次範圍**

### 驗收

- （已完成）單元測試 `places/search/route.test.ts`：(a) 無偏向結果在候選城市附近 → 只呼叫 1 次；(b) 無偏向結果是遠處的同名地點 → 逐城市展開；(c) 附近都查不到 → 直接用已經查到的無偏向結果，不再多打一次（舊版會多打一次，所以最壞情況是 N+1 次）
- （已實作）城市中心查詢和無偏向搜尋並行，不增加等待時間
- （已完成，使用者驗證）真實驗證：開羅+西奈半島搜「獅身人面像」，確認 1 次呼叫就得到正確結果

---

## 2. stop-suggestions：讓快取真的能被重用

### 現況

[`stop-suggestions/route.ts`](../src/app/api/v1/days/[dayId]/stop-suggestions/route.ts)：

- 以「被替換的那個 stop」的座標為錨點（`anchor`），對 `tourist_attraction`/`museum`/`park`/`amusement_park` **分 4 次**打 Nearby（半徑 20km，衛星小鎮 6km），每種 type 保證留 3 個
- 分開打是刻意的：合併成一次搜尋時，數量多的 type（tourist_attraction）會把稀有的 type（amusement_park）擠出前 20 名
- `fetchNearbyPlaceCandidates` 有快取，但 cache key 的座標四捨五入到小數第 4 位（約 11m）。**每換一個 stop 就是新錨點、新的 4 次呼叫**，就算兩個 stop 只差 500m、搜尋範圍幾乎完全重疊也一樣
- 候選的篩選（排除當天已有的景點、位置重複、衛星距離）都是在拿到結果**之後**才做，所以快取結果本身跟當天內容無關，本來就可以跨 stop 共用

### 選項

| 選項 | 做法 | 效果 | 風險 |
|---|---|---|---|
| **A. 搜尋中心對齊網格（建議）** | 非衛星情境下，把送給 Google 的搜尋中心 snap 到較粗的網格（例如 0.05°，約 5km），篩選仍用原始錨點座標 | 同城市內大部分「換一個」會命中同一組快取，一個城市約 4 次就夠用 30 天 | 搜尋圓心最多偏移約 3.9km，相對 20km 半徑影響很小 |
| B. 改用城市中心當錨點 | 非衛星情境改用 `getCityCenter(cityHint)` | 每城市固定 4 次 | 城市很大或景點偏郊區時會偏離使用者正在看的區域；而且 `cityHint` 可能不存在，要保留 fallback |
| C. 合併成一次 Nearby | 4 種 type 放進同一個 `includedTypes`，事後用回傳的 `types` 欄位分桶 | 每個錨點 4 → 1 次 | 就是現行註解說的問題：稀有 type 可能根本不在前 20 名，保證名額失效 |

**建議 A**：每種 type 保證名額的行為完全保留，只改搜尋圓心。衛星情境（6km 半徑，錨點位置很關鍵）**維持原座標不 snap**。

C 可以之後當實驗：拿幾個已有 4-type 快取的城市（京都、開羅）各花 1 次呼叫打合併查詢，比較稀有 type 是否真的被擠掉，再決定。不列入這次範圍。

### 實作要點

- 只改 route 裡傳給 `fetchNearbyPlaceCandidates` 的 `coords`，`isNearAnchor`、`isNotDuplicateLocation` 繼續用原始座標
- snap 函式放 `src/lib/`（純函式、好測），不要寫死在 route 裡
- 這個改動會讓現有的 `NearbyPlaceCandidatesCache` 在這條路徑上全部 miss 一次（key 變了），屬於一次性成本

### 驗收

- （已完成）`snapToGrid` 放在 `src/lib/geo.ts`，網格 0.05°；單元測試 `geo.test.ts`（相鄰點對齊同一格、沒有浮點誤差、負座標、最大偏移）
- （已完成，使用者驗證）真實驗證：同一天對兩個相距 < 2km 的 stop 各按一次「換一個」，第二次應該完全命中快取（`NearbyPlaceCandidatesCache` 沒有新增寫入）
- （已完成，使用者驗證）衛星情境（華沙→克拉科夫移動日的 Raszyn）結果跟改動前一致

---

## 3. `MOCK_PLACES`：不付費測 UI 流程

### 現況

- `MOCK_AI` 只接在 4 個路由（`stop-suggestions`、`accommodation/regenerate`、`accommodation/select`、`transit-recommendations`），而且是整個路由提早 return fixture
- `generate-stream`、enrich、`places/search`、`restructure` 都一定打真的 Google。生成一個新城市的行程就是幾十次 Text Search
- 好消息是，所有 Google 呼叫最後都收斂到少數幾個 `fetch`：

| 位置 | API |
|---|---|
| `src/lib/placesTextSearch.ts` `searchPlaceText()` | Text Search（enrich、城市中心、搜尋） |
| `src/lib/fetchCityRestaurants.ts` 三處 `fetch(NEARBY_SEARCH_URL)` | Nearby（城市提示、候選池、最近車站） |
| `src/lib/distanceMatrix.ts` | Routes API（Compute Route Matrix） |
| `src/app/api/v1/places/[placeId]/photo/route.ts` | Place Photo |

### 設計

- 新增 `MOCK_PLACES=1` 環境變數，在上面這幾個 **fetch 層**判斷；開啟時回傳確定性的假資料，不發出網路請求。上層的快取、篩選、排程邏輯全部照常跑，所以 UI 流程和規則引擎路徑都測得到
- 假資料要「地理上合理」，否則後面的 80km 可疑距離檢查會把所有東西標成可疑：
  - 城市中心：優先查 `src/lib/airports.ts` 的 `AIRPORTS` 表，查不到就用城市名 hash 出固定座標
  - Text Search / Nearby：以 `locationBias` 或搜尋中心為圓心，用查詢字串 hash 出幾百公尺內的偏移
  - placeId 一律加 `mock-` 前綴；photo route 遇到 `mock-` 開頭就回一張 placeholder
  - Distance：直接用 haversine 距離配固定速度估算時間
- **最重要的一點：假資料不能汙染 `dev.db` 的快取。** enrich 路由會把 Text Search 結果以真實查詢字串為 key 寫進 `PlaceQuery`，假資料一旦寫進去，之後關掉 mock 也會一直命中假地點。建議做法是 mock 模式必須搭配獨立的資料庫（例如 `prisma/mock.db`）：`MOCK_PLACES=1` 而 `DATABASE_URL` 指向 `dev.db` 時直接在啟動時拋錯，而不是靠每個寫入點各自記得跳過

### 不在範圍

- `generate-stream` 的 OpenAI 呼叫仍然是真的。`MOCK_PLACES` 只省 Google 的錢；要讓主流程完全免費，還得把 `MOCK_AI` 擴充到 `planTrip()`、`generateSkeletonCopy()` 等呼叫，這是另一個獨立項目
- 整合測試目前靠 `MOCK_AI` 跑，不需要改

### 驗收

- （已實作）所有 Google 呼叫（Text Search、3 個 Nearby、Routes）改走 [`src/lib/googleFetch.ts`](../src/lib/googleFetch.ts)，假資料在 [`src/lib/mockPlaces.ts`](../src/lib/mockPlaces.ts)；照片路由在 mock 模式下直接回 placeholder SVG；`db.ts` 載入時檢查資料庫。啟動方式：`npm run dev:mock`（`scripts/dev-mock.mjs` 會自動建立或同步 `prisma/mock.db`；可以傳參數，例如 `npm run dev:mock -- -p 3001`）
- （已完成）單元測試 `mockPlaces.test.ts`：mock 模式下不呼叫 `fetch`、結果固定、座標在 bias 附近、城市查詢落在已知城市座標、Nearby 數量和 type 正確、Routes 時間依交通方式變化、資料庫保護
- （已完成）實際啟動 `npm run dev:mock`：城市搜尋和景點搜尋回傳 `mock-` 地點，布拉格座標正確；照片回傳 SVG；`MOCK_PLACES=1` 指向 `dev.db` 時啟動就被擋下
- （已完成，使用者驗證）手動：在 mock 模式下完整生成一個行程、按換一批、加景點，確認 Cloud Console 上 Places 用量沒有增加
- 已知限制：只有 `AIRPORTS` 表裡的城市有真實座標，其他城市（例如京都）會落在固定但不真實的位置；沒有寫城市名稱的無偏向景點搜尋也一樣，所以 attraction-search 在 mock 模式下常常會走逐城市展開。這些只影響 mock 的真實感，不影響是否計費

---

## 進度

- [x] 0-3. `dev.db` 移出 git 追蹤（`.gitignore`、README 已改；`git rm --cached prisma/dev.db prisma/dev.db.bak` 已執行）
- [x] 0-1. enrich 記住查詢失敗的項目
- [x] 0-2. enrich 請求去重（`searchPlaceText` in-flight 去重）
- [x] 1. attraction-search 先無偏向再展開
- [x] 2. stop-suggestions 搜尋中心對齊網格
- [x] 3. `MOCK_PLACES` + 獨立 mock 資料庫（`npm run dev:mock`）
- [ ] （之後再評估）stop-suggestions 合併 Nearby 查詢的實驗
- [ ] （之後再評估）`MOCK_AI` 擴充到 `generate-stream` 規則引擎路徑

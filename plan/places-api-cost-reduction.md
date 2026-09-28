# Places API 測試成本降低計畫

> 建立日期：2026-09-28
> 起因：追查 9/17、9/18 的 Places 費用（見下方「背景」）

---

## 背景

9/17、9/18 的 Places 呼叫主要花在兩件事：一是用 UI 生成新城市行程後的 enrich（華沙/克拉科夫約 56 次、開羅約 82 次 Text Search），二是開羅行程上反覆測「換一批」和「加景點」。前者是正常成本（新城市本來就要查一次，之後會命中快取）；後者則暴露了兩個「同一個使用者動作打出好幾倍呼叫」的放大點，再加上一個結構性問題：**目前沒有辦法在不付費的情況下測主流程**。

從 `dev.db` 快取寫入紀錄反推（只算得到「沒命中快取且查詢成功」的呼叫，實際只會更多）：

| 日期（台灣時間） | Text Search 新寫入 | Nearby 新寫入 | 主要來源 |
|---|---|---|---|
| 9/17 21:58–23:56 | 58 | 16 | 華沙/克拉科夫 UI 生成的 enrich；Phase 3–5 真實資料驗證 |
| 9/18 20:25–20:47 | 93 | 18 | 開羅 enrich；開羅/吉薩「換一批」12 次 Nearby；加景點搜尋每個詞打 2–3 次 |

本計畫處理三件事，彼此獨立，各開一個分支：

1. `places/search` 的 attraction-search：對每個候選城市各打一次 Text Search
2. `stop-suggestions`：每換一個錨點就要 4 種 type 各打一次 Nearby
3. `MOCK_PLACES`：讓 UI 流程測試可以完全不打 Google

建議順序：1 → 2 → 3（由小到大；1、2 各自是單一檔案的改動，3 會跨多個檔案）。

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

- 單元測試（mock `searchPlaceText`）：(a) 無偏向結果落在候選城市附近 → 只呼叫 1 次；(b) 無偏向結果在遠處（模擬台北同名地點）→ 走逐城市偏向，行為跟現行一致；(c) 無偏向沒結果 → 走逐城市偏向
- 真實驗證：開羅+西奈半島搜「獅身人面像」，確認 1 次呼叫就得到正確結果

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

- snap 函式單元測試（邊界、負座標、南半球）
- 真實驗證：同一天對兩個相距 < 2km 的 stop 各按一次「換一個」，第二次應該完全命中快取（`NearbyPlaceCandidatesCache` 沒有新增寫入）
- 衛星情境（華沙→克拉科夫移動日的 Raszyn）結果跟改動前一致

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

- 單元測試：每個 fetch 層在 `MOCK_PLACES=1` 下不呼叫 `fetch`（用 `vi.stubGlobal` 驗證）、同樣輸入回傳同樣結果
- 手動：用 `mock.db` + `MOCK_PLACES=1` 跑 `npm run dev`，生成一個新城市行程、按換一批、加景點，Cloud Console 上 Places 用量完全沒增加
- 啟動保護：`MOCK_PLACES=1` 指向 `dev.db` 時確實拋錯

---

## 進度

- [ ] 1. attraction-search 先無偏向再展開
- [ ] 2. stop-suggestions 搜尋中心對齊網格
- [ ] 3. `MOCK_PLACES` + 獨立 mock 資料庫
- [ ] （之後再評估）stop-suggestions 合併 Nearby 查詢的實驗
- [ ] （之後再評估）`MOCK_AI` 擴充到 `generate-stream` 規則引擎路徑

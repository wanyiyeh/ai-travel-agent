---
paths:
  - "src/lib/**/*"
  - "src/app/api/**/*"
  - "scripts/**/*"
---

# Google API 成本防護

背景：2026-07 曾發生 Google API 費用暴增（`plan/google-api-cost-spike-2026-07.md`、`plan/places-api-cost-reduction.md`）。動到任何會查地點、路線、照片的程式碼前先讀這頁。

## 條款限制（ADR-0004，優先於下面的快取做法）

- Google Maps Platform 條款只允許儲存 place ID，以及最多 30 天的座標；名稱、地址、評分、類型、照片名稱、路線時間與距離都不能存。
- 寫入行程、候選紀錄、垃圾桶時，`src/lib/db.ts` 用 `src/lib/placeStorage.ts` 的白名單移除 Google 欄位（`COMPLIANT_PLACE_STORAGE=1` 時生效）。**新增自己的欄位要加進白名單**，否則會被丟掉；Google 的欄位一律不加。
- 現有的快取表正依 PLAN-001 改造。改造完成前：**不新增任何儲存 Google 內容的快取或欄位**；要省錢就合併同一請求內的重複查詢、改用較低的計費等級，或只在需要時才查。

## 單一出口

- 所有計費的 Google HTTP 呼叫（Text Search、Nearby Search、Routes）都經過 `src/lib/googleFetch.ts`，`MOCK_PLACES` 才能在一個地方把它們換成假資料（`src/lib/mockPlaces.ts`）。照片路由自己檢查 `isMockPlaces()`。
- **新增任何 Google API 呼叫點都要走 `googleFetch.ts`**，否則 mock 模式下照樣計費。
- `scripts/*` 還是直接用 `fetch` 呼叫 Google，繞過了這個出口；跑它們一律依 R1 先問。

## 資料進入的路徑

- `placesTextSearch.ts`：Text Search，取單一最佳結果（補資料、城市搜尋）。同時間相同的請求會合併成一次（in-flight dedupe）。
- `fetchCityRestaurants.ts`：Nearby Search，批次取候選，注入 prompt 或給候選池、`stop-suggestions` 用。
- `placeCache.ts`：`Place`/`PlaceQuery` 快取的唯一入口（有幾個 script 自己重寫了這段邏輯，沒有 import 它）。

## 快取與「記住沒找到」

- 各種 `*Cache` 資料表把 Google/AI 的結果按不同形狀快取起來，同城市、同路線重複生成時不再付費。
- **失敗的查詢不寫進快取**，只有「確定找不到」才記，這樣暫時性錯誤下次會重試，不會被永久釘死。
- 因此任何新的查詢路徑都要自己處理「記住沒找到」，不然每次都會重新計費。現有做法：
  - 補資料路由把失敗記在項目上的 `enrichFailure`（以查詢字串為 key，一段時間後才重試，見 `src/lib/enrichFailure.ts`）。
  - `getCityCenter` 把確定沒找到的城市記在 `CityCenterMissCache`。

## 比對錯誤的防護

- `SUSPICIOUS_DISTANCE_KM`（`src/lib/geo.ts`）：地點離預期城市超過這個距離就標記為可疑（`suspicious`），通常是 Google 比對到另一個城市或國家的同名地點，不直接信任。

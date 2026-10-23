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
- 座標附 `coordsFetchedAt`：寫入時沒有時間的座標會蓋上現在的時間，所以**不可以**把舊座標去掉時間再寫回去。`src/lib/coordsPurge.ts` 刪除超過 30 天的座標（ADR-0006）。
- **不新增任何儲存 Google 內容的快取或欄位**；要省錢就合併同一請求內的重複查詢（`src/lib/requestMemo.ts`）、改用較低的計費等級，或只在需要時才查。

## 出處標示

- 沒有搭配 Google 地圖、卻顯示 Google 地點內容（名稱、地址）的畫面，要放 `src/components/GoogleMapsAttribution.tsx`（官方 Google Maps 標誌，放在內容上方或下方、同一個容器裡）。目前放在行程列表（含列印）、生成預覽、三種候選清單、整天編輯、垃圾桶、重新規劃的必去景點。**新增這類畫面時要一起加**。
- 地圖本身有 Google 的標示，`ItineraryMap` 裡不用另外加。
- 標誌檔在 `public/attribution/`，來自官方 Google_Maps_Attribution_Assets.zip，不可修改。
- 照片：縮圖可以不標作者，因為點縮圖會打開 `src/components/PlaceDetailsDialog.tsx`（Places UI Kit 的 Place Details 元件），裡面內建 Google Maps 標示、照片作者與原始頁面連結。**新增顯示照片的地方要用 `PlacePhotoThumb`**，不要自己畫照片。
- Places UI Kit 每建立一個元件計費一次（Essentials）。2026-10-23 用 `/dev/place-details` 實測：開著時重新渲染不會多計費，只有打開才算。mock 模式的假地點不載入元件。

## 單一出口

- 所有計費的 Google HTTP 呼叫（Text Search、Nearby Search、Routes）都經過 `src/lib/googleFetch.ts`，`MOCK_PLACES` 才能在一個地方把它們換成假資料（`src/lib/mockPlaces.ts`）。照片路由自己檢查 `isMockPlaces()`。
- **新增任何 Google API 呼叫點都要走 `googleFetch.ts`**，否則 mock 模式下照樣計費。
- `scripts/*` 還是直接用 `fetch` 呼叫 Google，繞過了這個出口；跑它們一律依 R1 先問。

## 資料進入的路徑

- `placesTextSearch.ts`：
  - **`resolvePlace`**：只是要「找到地點」時用這個（補資料、城市中心）。Text Search 只取 `places.id`（Essentials IDs Only，免費），再用 Place Details 取 `location,types,formattedAddress`（Essentials）。已知 place ID、只缺座標時直接用 `fetchPlaceEssentials`。
  - **`searchPlaceText`**：要把名稱顯示給使用者時才用（「加景點」的搜尋框），Pro 等級。
  - 欄位計費等級以官方表為準：developers.google.com/maps/documentation/places/web-service/data-fields。兩者都會合併同時間相同的請求。
- `fetchCityRestaurants.ts`：Nearby Search 與 Text Search，批次取候選，注入 prompt 或給候選池、`stop-suggestions` 用。實際的查詢在 `PlaceSource` 介面後面（目前只有 `googlePlaceSource`），換資料來源時只換這一處。
- `placeDisplay.ts`：Place Details，依 place ID 取回名稱、地址與座標（Pro 等級；座標是 Essentials 欄位，不多付錢），給「只存 place ID」的資料補回顯示用的欄位，並補回被清掉的座標；只合併同一次呼叫內的重複，不跨請求保存（ADR-0004、ADR-0006）。
- `placeCache.ts`：`Place`/`PlaceQuery` 快取的唯一入口。只存 place ID（`PlaceQuery`，永久）與座標（附 `coordsFetchedAt`，超過 `COORDS_MAX_AGE_MS` 視為沒有）。**查詢字串（快取的 key）必須是我們自己的文字**（LLM 寫的名稱、使用者輸入），不可用 Google 回傳的名稱當 key。

## 同一請求內共用與「記住沒找到」

- 候選池、城市提示、最近車站、路線（Routes）的結果不能跨請求保存（ADR-0004），只在同一個請求內共用：`runMetered`（`src/lib/usageMeter.ts`）設定請求邊界，`memoizeSuccessInRequest`（`src/lib/requestMemo.ts`）讓重複的查詢只付一次。請求結束就丟掉，所以同城市再生成一次會再付費。
- `*Cache` 資料表只留給 AI 結果與我們自己的資料；`CityPlaceHintsCache`、`NearbyPlaceCandidatesCache`、`NearestStationCache`、`DistanceCache` 已不再讀寫。
- **失敗的查詢不記**，只有「確定找不到」才記，這樣暫時性錯誤下次會重試，不會被釘死。查詢函式失敗時回傳 `undefined`，確定沒有結果時回傳 `[]` 或 `null`。
- 會寫進資料庫的「記住沒找到」只能用我們自己的文字當 key。現有做法：
  - 補資料路由把失敗記在項目上的 `enrichFailure`（以查詢字串為 key，一段時間後才重試，見 `src/lib/enrichFailure.ts`）。
  - `getCityCenter` 把確定沒找到的城市記在 `CityCenterMissCache`。

## 比對錯誤的防護

- `SUSPICIOUS_DISTANCE_KM`（`src/lib/geo.ts`）：地點離預期城市超過這個距離就標記為可疑（`suspicious`），通常是 Google 比對到另一個城市或國家的同名地點，不直接信任。

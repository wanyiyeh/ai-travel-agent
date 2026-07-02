# Google APIs 使用筆記

共用同一把 API Key，於 `.env` 設定：

```
GOOGLE_PLACES_API_KEY=...          # 後端使用
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=... # 前端使用
NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID=...  # 地圖樣式 ID
```

---

## 1. Maps JavaScript API（前端）

**用途：** 顯示互動地圖、標記景點位置、畫折線路徑

**使用位置：** `src/components/ItineraryMap.tsx`

**主要功能：**
- `APIProvider` 載入地圖
- `google.maps.LatLngBounds` 自動縮放到所有景點
- `google.maps.Polyline` 畫出每天的移動路徑（含方向箭頭）
- 需在 Google Cloud Console 啟用：**Maps JavaScript API**

---

## 2. Places API (New) — Text Search（後端）

**端點：** `POST https://places.googleapis.com/v1/places:searchText`

**使用位置：**
- `src/app/api/v1/stops/[stopId]/enrich/route.ts` — 搜尋景點
- `src/app/api/v1/days/[dayId]/accommodation/enrich/route.ts` — 搜尋住宿區域

**目前抓取欄位：**

| 欄位 | 景點 enrich | 住宿 enrich |
|------|:-----------:|:-----------:|
| `places.id` | ✓ | ✓ |
| `places.formattedAddress` | ✓ | ✓ |
| `places.location` | ✓ | ✓ |
| `places.rating` | ✓ | ✓ |
| `places.regularOpeningHours` | ✓ | |
| `places.priceLevel` | | ✓ |

**搜尋邏輯：**
- 景點：`景點名稱 + context（城市）`
- 住宿：`住宿區域名稱 + 國家`（不指定特定飯店，讓使用者自行比較）

**需在 Google Cloud Console 啟用：** **Places API (New)**

---

## 3. Places API (New) — Nearby Search（後端）

**端點：** `POST https://places.googleapis.com/v1/places:searchNearby`

**使用位置：** `src/lib/fetchCityRestaurants.ts`

**用途：** 根據經緯度搜尋附近餐廳，作為 AI 餐廳推薦的參考資料

**需在 Google Cloud Console 啟用：** **Places API (New)**（同上）

---

## 4. Distance Matrix API（後端）

**端點：** `GET https://maps.googleapis.com/maps/api/distancematrix/json`

**使用位置：** `src/lib/distanceMatrix.ts`

**用途：** 計算兩個景點之間的實際交通時間與距離，用於交通時間的驗證或顯示

**需在 Google Cloud Console 啟用：** **Distance Matrix API**

---

## 可擴充的欄位（尚未使用）

Places API 還有以下欄位對旅遊 App 有價值：

| 欄位 | 用途 |
|------|------|
| `displayName` | 地點的本地語言名稱 |
| `websiteUri` | 官方網站 |
| `googleMapsUri` | Google Maps 直連 |
| `userRatingCount` | 評分人數（判斷評分可信度） |
| `editorialSummary` | 景點/住宿簡介 |
| `photos` | 照片（需另打 media endpoint） |
| `types` / `primaryType` | 地點分類（景點/餐廳/住宿） |
| `businessStatus` | 是否已永久關閉 |

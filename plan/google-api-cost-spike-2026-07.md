# Google API 費用暴增調查與修復（2026-07-18 / 2026-07-24）

> 調查日期：2026-08-04

---

## 背景

使用者發現 Google Cloud 帳單在 **7/18** 與 **7/24** 兩天有明顯暴增。這兩天都沒有直接的 GCP 帳單數據可查，以下是從 git 紀錄、檔案修改時間、程式行為交叉比對後，找到的兩個具體技術成因，並已完成對應修復。

---

## 7/18 暴增：`district` 欄位讓 Text Search 快取全面失效

### 成因

commit `b920689`（7/17）在 stop enrich 的查詢字串加入 `district`（行政區）欄位，把查詢從：

```
名稱 + 城市
```

改成：

```
名稱 + 行政區 + 城市
```

但 `PlaceQuery` 快取表是**用查詢字串本身當 primary key**。查詢字串一變，所有先前已快取的地點全部變成新的 cache key，等於一夕之間**整批快取失效**。如果 7/18 有跑過批次重新 enrich（`npm run enrich-all` 或使用者重新產生多筆行程），每個 stop 都會 cache miss，強迫重新打一次 Google Places Text Search（付費）。

### 額外發現的連帶問題

`scripts/backfill-place-cache.ts` 寫入快取用的 key 是「名稱 + 城市」（**沒有** district），跟線上 enrich route 的「名稱 + district + 城市」對不上。這支 script 回填的快取實際上永遠不會被線上路由命中，等於白做工——之後每次真的呼叫 enrich 還是會重打 Google，快取持續處於碎片化狀態。

### 修復

在 [`src/lib/placesTextSearch.ts`](../src/lib/placesTextSearch.ts) 新增兩個共用函式，作為 query-building 的唯一來源：

```ts
export function buildStopQuery(name, district, cityHint): string
export function buildMealQuery(name, cityHint): string
```

並統一套用到所有原本各自組字串的地方：

| 檔案 | 說明 |
|---|---|
| `scripts/backfill-place-cache.ts` | 補上 `district`，改用 `buildStopQuery` — 修掉本次發現的 key 不對齊問題 |
| `src/app/api/v1/stops/[stopId]/enrich/route.ts` | 單筆 stop enrich |
| `src/app/api/v1/itinerary/[id]/enrich-all-stops/route.ts` | 批次 enrich（stop + meal 各一處） |
| `scripts/enrich-all-itineraries.ts` | 全庫批次 enrich script（stop + meal 共 4 處） |

之後若要調整 query 組成規則，只需要改這兩個共用函式，不會再有某個呼叫點漏改、導致 cache key 對不上而重複計費的情況。

---

## 7/24 暴增：新增照片功能引入兩種新的付費呼叫

### 成因 1：Photo Media 端點沒有伺服器端快取

`src/app/api/v1/places/[placeId]/photo/route.ts` 是新增的照片代理路由：瀏覽器打這支 API，它再即時呼叫 Google `places/{photoName}/media` 取得簽名圖片網址並 302 redirect。原本**完全沒有伺服器端快取**，只靠 redirect response 上的 `Cache-Control` 讓瀏覽器自己快取。

問題：`AccommodationPicker`／`MealPicker` 每個候選都掛一張縮圖，開發時反覆重整頁面、開不同分頁/無痕視窗測試，每次都是全新請求，等於每次都重新對 Google 計費一次。

### 成因 2：Place Details 補圖邏輯掃全庫且預設開啟

`scripts/enrich-all-itineraries.ts` 新增了 `fetchPlacePhotoName()`，用 Place Details API 幫「已經 enrich 過但沒有照片」的地點補照片。這是先前完全不存在的一整類付費請求，而且**沒有開關、無條件跑**——只要執行 `npm run enrich-all`（原本的用途只是幫沒有座標的 stop 補地理編碼），就會順便對資料庫裡**每一個**已存在的 placeId 都打一次 Place Details。本機資料庫如果累積了不少種子行程，一次全庫掃描就是一次性的用量暴增。

### 修復

**1. Photo Media 端點加上 in-process 快取**（[`photo/route.ts`](../src/app/api/v1/places/%5BplaceId%5D/photo/route.ts)）

```ts
const PHOTO_URI_TTL_MS = 50 * 60 * 1000; // 對齊 Google 簽名網址約 60 分鐘的有效期
const photoUriCache = new Map<string, { photoUri: string; expiresAt: number }>();
```

Key 是 `photoName:maxWidthPx`，TTL 內任何來源（不同分頁、不同瀏覽器、hard refresh）的重複請求都直接從記憶體回傳，不再重打 Google。限制：只在單一 dev server process 內有效，重啟會清空——本機開發足夠，正式環境如果跑多個 instance 需要換成共用快取（目前不需要）。

**2. Place Details 補圖改為 opt-in + 有上限**（[`enrich-all-itineraries.ts`](../scripts/enrich-all-itineraries.ts)）

```bash
# 平常的地理編碼用途，不會再順便觸發全庫補圖
npm run enrich-all

# 要補圖要明確加旗標，並限制單次上限
npm run enrich-all -- --backfill-photos --photo-limit=50
```

- `--backfill-photos`：不加就完全不會呼叫 Place Details
- `--photo-limit=N`：用即時計數器 `photoCallsMade` 控管，達到上限就跳過剩下的地點，並在結尾提示「還有地點未補、可重跑繼續」

---

## 如何驗證

去 GCP Console → Billing → Reports，用 SKU 分開看：

- `Places API Text Search`：對應 7/18 的 district 快取失效問題
- `Place Details` / `Places Photo`：對應 7/24 的照片功能

確認尖峰出現在對應的 SKU 上，就能對上以上兩個修復的因果關係。

---

## 修改檔案總覽

| 檔案 | 變更 |
|---|---|
| `src/lib/placesTextSearch.ts` | 新增 `buildStopQuery` / `buildMealQuery` 共用函式 |
| `src/app/api/v1/stops/[stopId]/enrich/route.ts` | 改用共用 query builder |
| `src/app/api/v1/itinerary/[id]/enrich-all-stops/route.ts` | 改用共用 query builder |
| `scripts/enrich-all-itineraries.ts` | 改用共用 query builder；補圖改為 `--backfill-photos` + `--photo-limit` opt-in |
| `scripts/backfill-place-cache.ts` | 補上 `district`，修掉 cache key 對不上的問題 |
| `src/app/api/v1/places/[placeId]/photo/route.ts` | 加上 in-process 簽名網址快取（50 分鐘 TTL） |

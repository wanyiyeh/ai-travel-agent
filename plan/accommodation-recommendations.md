# 住宿推薦功能實作計畫

## 使用者故事

> 作為一名繁忙的自助旅行者，我希望系統能根據我的景點安排直接推薦最合適的住宿，以便我不需要在多個地圖分頁中切換比較，就能完成訂房。

---

## 現況分析

- `Accommodation` type 已存在，包含 `name` 和 `area` 兩個欄位
- AI 生成行程時已一併產生住宿建議
- 住宿資訊目前以靜態文字顯示在每日標題（read-only）
- 無地圖標記、無評分、無訂房連結、無重新推薦功能

---

## 變更範圍

### 1. 型別與 Schema 擴充

**檔案：`src/types/itinerary.ts`**

擴充 `Accommodation` 型別，加入 Google Places 回傳的豐富資料：

```ts
interface Accommodation {
  name: string;
  area: string;
  // 新增
  placeId?: string;
  lat?: number;
  lng?: number;
  address?: string;
  rating?: number;
  priceLevel?: number; // 0–4，對應 Google Places 價位等級
  bookingUrl?: string; // Booking.com 搜尋連結或 Google Maps 連結
}
```

**檔案：`src/lib/schemas.ts`**

同步更新 `AccommodationSchema`，讓 Zod 驗證包含新欄位（全部 optional）。

---

### 2. 住宿 Enrich API

**新增檔案：`src/app/api/v1/days/[dayId]/accommodation/enrich/route.ts`**

- 方法：`POST`
- 輸入：`{ itineraryId: string }`
- 流程：
  1. 從 DB 讀取該 day 的 `accommodation.name` + `accommodation.area`
  2. 呼叫 Google Places Text Search API 查詢
  3. 取回 `placeId`、`lat`、`lng`、`address`、`rating`、`priceLevel`
  4. 產生 `bookingUrl`（Booking.com 以住宿名稱搜尋的連結）
  5. 更新 `Itinerary.days` JSON 並存回 DB
- 輸出：`{ success: true, accommodation: Accommodation }`

---

### 3. 住宿重新推薦 API

**新增檔案：`src/app/api/v1/days/[dayId]/accommodation/regenerate/route.ts`**

- 方法：`POST`
- 輸入：`{ itineraryId: string }`
- 流程：
  1. 讀取該 day 的所有 stops（名稱、區域）作為位置脈絡
  2. 讀取目前住宿（避免重複推薦）
  3. 呼叫 OpenAI，以景點分佈為依據推薦地理位置最適合的住宿
  4. 觸發 enrich（呼叫 Google Places 補充資料）
  5. 更新 DB
- 輸出：`{ success: true, accommodation: Accommodation }`

AI prompt 重點：
- 根據當天景點的地理重心推薦住宿區域
- 符合行程整體 budget 偏好
- 避免重複推薦已拒絕的住宿

---

### 4. UI：住宿卡片元件

**修改檔案：`src/components/EditableItineraryCard.tsx`**

將日標題中的住宿文字區塊升級為互動卡片，包含：

| 元素 | 說明 |
|------|------|
| 住宿名稱 + 區域 | 原有資訊保留 |
| 星等評分 | Google Places rating，顯示星星圖示 |
| 地址 | Places 回傳的完整地址 |
| 價位等級 | `$` ~ `$$$$` 顯示 |
| 「重新推薦」按鈕 | 呼叫 regenerate API，loading 狀態顯示 spinner |
| 「前往訂房」按鈕 | 開啟 `bookingUrl`（新分頁） |

載入流程：
- 進入頁面時，若 `placeId` 為空，自動觸發 enrich API
- enrich 完成後更新畫面，不需使用者手動操作

---

### 5. 地圖整合

**修改檔案：`src/components/ItineraryMap.tsx`**

- 每日住宿以不同圖示（🏨 或紫色 pin）標記於地圖上
- 住宿標記點擊後顯示 InfoWindow，包含名稱、評分、「前往訂房」連結
- 住宿標記納入地圖自動縮放範圍（`fitBounds`）

---

## 不在本次範圍

- 實際訂房 API 串接（Booking.com / Agoda partner API）
- 住宿比價功能
- 使用者自行輸入或搜尋住宿

---

## 實作順序

1. 擴充型別與 Schema
2. 實作 enrich API
3. 實作 regenerate API
4. 更新 UI 元件（住宿卡片）
5. 地圖整合（住宿標記）
6. 測試：enrich 自動觸發、重新推薦流程、地圖顯示

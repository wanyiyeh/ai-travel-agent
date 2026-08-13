# 使用者故事：行程編輯功能

> 整理自 `feat/accommodation-recommendations` 分支目前已實作的行程編輯功能，依功能領域分組。
> 涉及元件：`EditableItineraryCard.tsx`、`SortableStop.tsx`、`TransitRecommendationsPanel.tsx`、`ViewContent.tsx` 及相關 API routes。

## 一、拖曳排序行程點

- **身為使用者**，我想要拖曳同一天內的行程點來調整順序，**以便**依照我想要的路線安排一天的行程。
- **身為使用者**，我想要把某個行程點拖到別天（包含原本是空的一天），**以便**重新分配跨天的行程安排。

**系統行為 / 邊界情況**
- 拖曳失敗時自動還原到拖曳前的狀態（`structuredClone` 快照），並顯示 3 秒錯誤提示。
- 同天內重新排序後會清除該行程點的 `transport_from_prev` / `time_of_day`，並觸發交通資訊重新計算。
- 伺服器端 reorder 會在整個行程範圍內尋找行程點 ID（而非只找目標天），避免跨天拖曳時遺失資料。

**主要實作位置**
- `EditableItineraryCard.tsx`：`handleDragStart` / `handleDragOver` / `handleDragEnd`
- `SortableStop.tsx`：拖曳把手（drag handle）
- API：`POST /api/v1/stops/reorder`

---

## 二、行程點內容編輯

- **身為使用者**，我想要直接在行程卡片上編輯地點名稱、描述與停留時間（預設按鈕 30–240 分鐘，或以 ±15 分鐘微調），**以便**快速修正 AI 產生的內容。

**系統行為 / 邊界情況**
- 編輯中的行程點會停用拖曳功能（拖曳／編輯／載入三者互斥）。

**主要實作位置**
- `SortableStop.tsx`：行內編輯表單
- `EditableItineraryCard.tsx`：`handleEdit` / `handleSaveEdit`
- API：`PATCH /api/v1/stops/[stopId]`

---

## 三、新增／刪除行程點

- **身為使用者**，我想要手動輸入地點名稱新增到某一天，**以便**加入 AI 沒有規劃到的景點。
- **身為使用者**，我想要用勾選方式批次刪除某天的多個行程點，**以便**快速清空重排一整天。
- **身為使用者**，我想要在批次刪除後取得 AI／地理位置比對的候選景點建議（可從其他天重複使用，或取得全新建議），**以便**快速補齊被刪除的行程。

**系統行為 / 邊界情況**
- 手動新增若 Google Places 無法解析地點名稱，會回傳 404 並顯示錯誤訊息。
- 批次刪除採「選取 → 建議」兩階段流程，非一步到位。
- 刪除為循序處理（非 `Promise.all`），因行程 JSON 目前無樂觀鎖機制。
- 「重複使用」候選會依 haversine 距離（60km 內）或 `waypointCity` 過濾為同城市地點。

**主要實作位置**
- `EditableItineraryCard.tsx`：`handleAddStop` / `handleStartBulkEdit` / `handleApplyBulkDelete` / `handleConfirmBulkAdd`
- `DayBulkEditPanel.tsx`
- API：`POST /api/v1/days/[dayId]/stops`、`POST /api/v1/days/[dayId]/stop-suggestions`

---

## 四、重複與可疑地點偵測

- **身為使用者**，我想要在多天出現同名景點時看到「重複」標籤，**以便**發現規劃上的疏漏。
- **身為使用者**，我想要在地理編碼結果明顯異常時看到「可疑」標籤並附 Google 地圖連結，**以便**手動確認或修正錯誤地點。

**系統行為 / 邊界情況**
- 「可疑」判定條件：與同天其他行程點的中心點距離超過 80 公里（移動日的行程點會跳過此檢查）。
- 頁面載入時自動執行全行程檢查，並在頂部以通知橫幅彙整顯示所有被標記的行程點。

**主要實作位置**
- `EditableItineraryCard.tsx`：`duplicateStopInfo`、`enrichAllStops` effect
- `SortableStop.tsx`：標籤 UI
- API：`POST /api/v1/itinerary/[id]/enrich-all-stops`

---

## 六、住宿與餐廳候選選擇

- **身為使用者**，我想要瀏覽並選擇某天的住宿候選（含評分、價格、鄰近車站資訊），**以便**挑選最符合需求的飯店。
- **身為使用者**，我想要對早/午/晚餐分別重新產生候選並挑選，**以便**客製化每餐安排。
- **身為使用者**，我想要查看先前產生過的候選歷史紀錄（分頁），**以便**回頭選擇之前看過但沒選的選項。

**系統行為 / 邊界情況**
- 選擇「目前已選項目」時視為無動作（no-op）。
- 頁面載入時會自動為 AI 建議但缺少 `placeId` 的住宿補齊資料。

**主要實作位置**
- `AccommodationPicker.tsx` / `MealPicker.tsx`
- API：`.../accommodation/regenerate|select|candidates-history`、`.../meals/[mealType]/regenerate|select|candidates-history`

---

## 七、中繼點（Waypoint）建議與購物車

- **身為使用者**，我想要瀏覽 AI 建議的出發地與目的地之間（或單一城市的鄰近）中繼城市，**以便**發掘值得停留的地點。
- **身為使用者**，我想要依最長交通時數篩選建議，**以便**排除不符合行程節奏的城市。
- **身為使用者**，我想要將多個城市加入購物車並設定停留天數、調整順序與插入位置，**以便**規劃複雜的多城市行程。
- **身為使用者**，我想要一次套用購物車內容批次插入行程，**以便**避免逐一手動新增。
- **身為使用者**，我想要移除既有行程中的移動日中繼點，**以便**取消不需要的安排。

**系統行為 / 邊界情況**
- 建議結果依出發地／目的地組合做 session 快取。
- 已存在或已略過的城市會在前端過濾掉；篩選後清單為空會自動重新取得建議。
- 移除中繼點前需二次確認。

**主要實作位置**
- `TransitRecommendationsPanel.tsx`、`WaypointCart.tsx`、`TransitRecommendationCard.tsx`
- `ViewContent.tsx`：`handleAddToCart` / `handleBatchApply` / `handleRemoveFromCart`
- API：`POST /api/v1/itinerary/[id]/batch-insert-waypoints`、`DELETE /api/v1/itinerary/[id]/remove-waypoint`

---

## 八、檢視與總覽

- **身為使用者**，我想要在清單／地圖檢視間切換，**以便**用不同角度確認行程安排。
- **身為使用者**，我想要展開或收合所有天數、透過導覽列跳轉到指定天數，**以便**快速掌握整體行程。
- **身為使用者**，我想要查看每日與總計費用（自動換算為台幣）、路線縮寫麵包屑，**以便**掌握預算與路線全貌。
- **身為使用者**，我想要對某天按「重算交通」取得依真實距離（Google Distance Matrix）計算的交通建議，並取得 Google 地圖導航連結，**以便**確認交通方式與時間是否合理。

**主要實作位置**
- `ViewContent.tsx`

---

## 附錄：支援性基礎設施

以下非直接的使用者故事，但為上述功能提供共用能力：

- **地點文字搜尋與快取**：`placesTextSearch.ts` + `placeCache.ts`（`lookupByQuery` / `upsertPlace`），重複查詢的地點名稱會先命中快取再呼叫 Google Places API。
- **價格估算**：`priceLevelCost.ts`。
- **距離計算**：`distanceMatrix.ts`（`getDistancesForStopPairs` / `haversineKm`），同時用於「可疑地點」判定與交通資訊重算的真實距離依據。

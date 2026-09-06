# 使用者故事：行程編輯功能

> 整理自 `feat/accommodation-recommendations` 分支目前已實作的行程編輯功能，依功能領域分組。
> 涉及元件：`EditableItineraryCard.tsx`、`SortableStop.tsx`、`RestructurePanel.tsx`、`TransitRecommendationCard.tsx`、`ViewContent.tsx` 及相關 API routes。

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

## 五、重新規劃行程（城市層級重塑，含中繼點推薦）

- **身為使用者**，我想要用「加入城市／移除城市」的方式重新安排整趟行程的地點組合，**以便**在不逐一拖拽景點的情況下大幅調整路線。
- **身為使用者**，我想要指定某個必去景點並讓系統自動判斷它屬於哪個城市，**以便**確保這個景點一定會被排進行程（占滿一整天）。
- **身為使用者**，我想要瀏覽 AI 建議的出發地與目的地之間（或單一城市的鄰近）中繼城市，並依最長交通時數篩選，**以便**發掘值得停留、又符合行程節奏的地點。
- **身為使用者**，我想要把推薦城市直接加入城市清單、並拖曳到我想要的順序（包含既有城市中間），**以便**用同一套流程規劃整趟行程，不用在兩個不同的「加城市」介面之間切換。
- **身為使用者**，我想要調整每個城市的停留天數，**以便**控制行程節奏。
- **身為使用者**，我想要選擇既有城市裡哪些天要保留、哪些要捨棄，**以便**留下我滿意的安排，只重新生成其餘部分。
- **身為使用者**，我想要在套用前看到「保留幾天／移除哪幾天／AI 新規劃幾天」的差異預覽與套用後總天數，**以便**確認调整符合預期再送出。
- **身為使用者**，我想要移除既有行程中的移動日中繼點，**以便**取消不需要的安排。

**系統行為 / 邊界情況**
- 四步驟流程：① 加城市/必去景點（含 AI 推薦城市區塊） → ② 設定各城市天數 → ③ 勾選既有天保留/捨棄 → ④ 差異預覽並套用。
- 推薦結果依出發地／目的地組合做 session 快取；已存在或已略過的城市會在前端過濾掉，篩選後清單為空會自動重新取得建議。
- 城市清單支援拖曳排序，但僅新加入的城市可被拖動；既有城市彼此的相對順序固定，只能作為放置目標，避免既有城市的移動日內容跟實際順序不符。
- 移動日與行程最後一天（結構性天）一律視為必留，不出現在保留/捨棄清單中，也不受天數調整影響。
- 必去景點會單獨佔滿一整天（`duration_minutes: 480`），加入/移除時自動連動調整所屬城市的目標天數。
- 搜尋必去景點時，系統以景點座標離候選城市中心的距離（80km 門檻）自動判斷所屬城市；超過門檻或找不到候選城市時，跳出選單讓使用者手動指定。
- 套用為單一 transaction 整份重建行程（非逐步編輯），被捨棄的天會存入垃圾桶（`deletedDay`）供之後復原，而非直接刪除；若拖曳重排導致某既有城市的「下一站」改變，該城市自己的出發移動日內容會重新生成，其餘天數維持重用。
- 移除中繼點前需二次確認。

**主要實作位置**
- `RestructurePanel.tsx`：四步驟精靈 UI 與本地狀態管理，含推薦區塊（`TransitRecommendationCard.tsx`）與城市清單拖曳排序
- `ViewContent.tsx`：`openRestructurePanel`（開啟面板並捲動到位，也是跨國銜接卡片「探索更多邊境城市」按鈕的行為）
- API：`POST /api/v1/places/search`（搜尋城市/景點）、`POST /api/v1/itinerary/[id]/transit-recommendations`（AI 推薦中繼城市）、`POST /api/v1/itinerary/[id]/restructure`（套用整份重建）、`DELETE /api/v1/itinerary/[id]/remove-waypoint`（移除中繼點）
- `src/lib/itineraryCityGen.ts`：生成新城市/補足天數所需的移動日、觀光日、住宿與三餐
- `src/lib/nearestCity.ts` / `src/lib/placesTextSearch.ts`：景點所屬城市判斷與地點文字搜尋

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

## 七、檢視與總覽

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

# 整天景點編輯模式 (Day-Level Bulk Attraction Editor) — 實作計畫

## 背景與問題

競品(去趣)用拼圖方式讓使用者主動挑選景點。目前這個 app 的「重新生成」是黑箱單選：
後端呼叫一次 LLM、AI 自己編一個替代景點，直接寫回資料庫，並把
`lat/lng/address/rating/placeId` 全部清成 `null`
(`src/app/api/v1/stops/[stopId]/regenerate/route.ts:142-161`)。

進一步討論後，決定不做單一景點的候選挑選，而是做**整天層級的編輯**：使用者在某一天
把不喜歡的景點勾掉刪除，系統詢問要不要推薦其他景點（推薦池可包含其他天已出現過的景點，
不必排除），使用者可補齊任意數量的景點、設定每個的預計停留時間，再手動拖曳排序整天。
若使用者選了一個跟其他天重複的景點，不擋下來，只在該天顯示警告徽章。

**這個設計取代原本的單一景點「重新生成」功能** —— 單一景點替換只是這個新流程的 N=1
特例（刪 1 個、補 1 個），不需要並存兩套機制。

---

## Phase 1 — 型別擴充 (Types & Schema)

### 新增 `src/types/itinerary.ts`

```typescript
export type StopCandidate = {
  name: string;
  description: string;
  duration_minutes: number;
  placeId?: string;
  lat?: number;
  lng?: number;
  address?: string;
  rating?: number | null;
  suspicious?: boolean;
  suspiciousReason?: string;
};
```

### 新增 `src/lib/schemas.ts`

`StopCandidateSchema`（對應上面型別，地理欄位皆 optional 以相容 fallback 形狀），
以及一個內部用、不外露的 schema 專門 parse 填描述用的 LLM 回應：
`{ candidates: [{ name, description, duration_minutes }] }`。

### 新增 `src/lib/mockAi.ts` fixture

`MOCK_FIXTURES.stopCandidates`（3 筆，含假的 `placeId/lat/lng/address/rating`）。

---

## Phase 2 — 資料抓取 (Places API)

### 新增 `fetchNearbyPlaceCandidates()` 於 `src/lib/fetchCityRestaurants.ts`

不改動既有的 `fetchNearbyPlaces`（同時被 `accommodation/regenerate/route.ts:111`
共用，改欄位遮罩會波及不相關流程）。

```typescript
export interface PlaceCandidate {
  name: string; rating?: number;
  placeId: string; lat: number; lng: number; address: string;
}
export async function fetchNearbyPlaceCandidates(
  coords: { lat: number; lng: number }, apiKey: string,
  types: string[], radius: number, maxCount = 8,
): Promise<PlaceCandidate[]>
```

欄位遮罩用 `"places.id,places.displayName,places.rating,places.location,places.formattedAddress"`。

---

## Phase 3 — API 路由

### 新增 `POST /api/v1/days/[dayId]/stop-suggestions`

**檔案**: `src/app/api/v1/days/[dayId]/stop-suggestions/route.ts`（新檔案）

**邏輯**:
1. 用該天剩餘景點（或城市中心，若剩 0 個）的座標，呼叫 `fetchNearbyPlaceCandidates`
   (5000m, `["tourist_attraction","museum","park"]`)；只排除「這一天內」已存在的名稱，
   **不排除其他天**的。
2. 一次 LLM 呼叫依序、依數量對應真實名稱補 description/duration（prompt 明確要求
   不可新增/省略/調換順序；解析失敗時用「Google 評分 X★」通用文案墊底）。
3. 用既有 centroid + `haversineKm` 邏輯(`enrich-all-stops/route.ts:6-12`,
   `SUSPICIOUS_KM=80`)標記 `suspicious`，不硬過濾。
4. 無 Google API key / 抓不到候選時 fallback 成 AI 純文字建議（無地理欄位），沿用
   現行 `regenerate/route.ts:108-135` 的 fallback prompt 邏輯。
5. 回傳 `{ candidates: StopCandidate[], isFallback: boolean }`，**不寫 DB**。

「其他天已出現的景點」這組建議**不需要 API** —— 前端已經持有完整 `itinerary` state
(`EditableItineraryCard.tsx:57`)，純 client-side 計算即可，且這些景點早已 enrich 過，
直接帶著完整地理資訊可用。

### 擴充 `POST /api/v1/days/[dayId]/stops`

**檔案**: `src/app/api/v1/days/[dayId]/stops/route.ts`（既有檔案）

- 舊形狀 `{ itineraryId, stopName }` **維持不變**（給既有的手動「+新增景點」文字輸入
  按鈕用，會呼叫 LLM 生成細節）。
- 新增可接受 `{ itineraryId, stops: StopCandidate[] }`：不呼叫 LLM（描述已在建議階段
  生成好），直接把每個 candidate 轉成 stop（帶 `placeId/lat/lng/address/rating`），
  指派新 `id`/`orderIndex`，**一次性** `prisma.itinerary.update`（單次讀寫）。

### 刪除 `src/app/api/v1/stops/[stopId]/regenerate/route.ts`

整支路由被新流程取代，直接刪除。

---

## Phase 4 — UI 元件

### 整天編輯模式（勾選保留/刪除）

- Day header 新增「編輯本日」按鈕，切換 `bulkEditDayId === day.id`。
- 進入批次模式後，該天每個 `SortableStop` 改渲染 checkbox（預設全勾=保留）取代現有的
  編輯/刪除/重新生成三顆圖示按鈕；`SortableStop.tsx` 新增
  `bulkMode`/`selected`/`onToggleSelect` props，移除「重新生成」按鈕與 `onRegenerate` prop。
- 底部顯示「保留 X 個、刪除 Y 個」+「取消」/「套用」按鈕。
- 按下套用：對每個被取消勾選的 stop **依序** `await` 呼叫既有的
  `DELETE /api/v1/stops/[stopId]`。

  **重要**：`DELETE` 路由 (`stops/[stopId]/route.ts:66-121`) 是整份 `itinerary.days`
  JSON 的讀-改-寫，沒有樂觀鎖。批次刪除**必須依序 await，絕不能 `Promise.all`**，
  否則並發呼叫會互相蓋掉（lost update）。

- 若刪除後該天變成 0 個景點，不阻擋，直接進入「推薦補齊」；但最終送出結果必須確保
  該天至少有 1 個景點。

### 補齊建議 UI（新元件 `src/components/DayBulkEditPanel.tsx`）

- 刪除完成後自動展開，顯示兩組建議：
  - **其他天已出現的景點**：從 `itinerary` state 篩出不在本天、且 `waypointCity`
    與本天相同的其他天景點（`waypointCity` 是生成時的必填欄位；若本天沒有這個欄位則
    不過濾，相容舊資料），每張卡片標「來自第 X 天」。這樣多城市行程（例如名古屋+大阪）
    編輯名古屋某天時，就不會推薦大阪的景點。
  - **新候選景點**：呼叫 `stop-suggestions` API 取得。
- 每組都可勾選任意數量，每個勾選項有「停留時間」數字輸入（預設帶入建議值/原景點時長）。
- 「加入行程」按鈕：把所有勾選項組成 `StopCandidate[]`，一次呼叫擴充後的
  `days/[dayId]/stops`（`{ itineraryId, stops: [...] }`）。
- 新增完成後呼叫既有 `recalculateTransport(dayId)`（`EditableItineraryCard.tsx:259-297`）
  刷新 transport_from_prev/time_of_day —— 整個「刪除+新增」流程只呼叫一次。

### 重新排序

不需要新工作 —— 新增的景點 append 在該天最後，使用者直接用既有的 `@dnd-kit` 拖曳排序
（`EditableItineraryCard.tsx:4-21`, `handleDragStart/Over/End`, `persistReorder` →
`POST /api/v1/stops/reorder`），全部已經可以正常運作。

### 跨天重複警告

- `EditableItineraryCard.tsx` 新增 `useMemo`，依 `days` 順序遍歷，對每個 stop 名稱做
  trim + 小寫正規化，用 `Set` 記錄已出現過的名稱；若某天的 stop 名稱在**更早的天數**
  已出現過，標記為跨天重複。
- 純衍生狀態，不寫入 DB、不改 `Stop` 型別。
- UI 沿用 `SortableStop.tsx:203-213` 現成的琥珀色徽章樣式（可疑地點徽章的視覺），
  文字改「重複」，tooltip 顯示「與第 X 天的『景點名稱』重複，建議進行編輯」。

---

## 實作順序與依賴關係

```
Phase 1 (型別 + schema + mock fixture)
    └─ Phase 2 (fetchNearbyPlaceCandidates)      ← 無依賴，可先做
        └─ Phase 3a (stop-suggestions route 新增)  ← 依賴 Phase 1+2
        └─ Phase 3b (days/[dayId]/stops 擴充)      ← 依賴 Phase 1
        └─ Phase 3c (刪除 regenerate route)
            └─ Phase 4 (UI：批次刪除/補齊面板/重複警告)  ← 依賴 Phase 3
```

## 技術決策

| 問題 | 決策 | 原因 |
|------|------|------|
| 批次刪除是否新建 bulk-delete API | 不新建，沿用既有單一 DELETE，依序 await | 當天景點數量少，延遲可接受；避免多維護一支功能重複的路由 |
| 批次刪除呼叫方式 | 依序 `await`，禁止 `Promise.all` | `itinerary.days` 是整份 JSON 讀-改-寫，無樂觀鎖，並發會 lost update |
| 批次新增寫入方式 | 一次呼叫、傳陣列，單次 `prisma.itinerary.update` | 避免多次讀-改-寫的競態問題，也比逐一呼叫快 |
| 其他天景點建議池 | 純前端計算，不新增 API | 資料已經在 `itinerary` state 裡，且已 enrich 過，零成本 |
| 跨天重複是否排除/擋下 | 只警告不擋，純前端 `useMemo` 衍生 | 使用者明確要求「允許重複，事後提醒」；不需要新的 DB 欄位或後端驗證 |
| 新候選景點是否排除其他天已用過的名字 | 不排除，只排除當天內的 | 對應「允許跨天重複」的產品決策 |
| 是否保留單一景點「重新生成」 | 刪除，整個功能被新流程取代 | 單一替換是新流程的 N=1 特例，不需要並存兩套黑箱/非黑箱邏輯 |

## Verification

1. `npm run dev`，開一個至少兩天、每天多個已 enrich 景點的行程。
2. 點某天的「編輯本日」→ 出現 checkbox，取消勾選 1-2 個 → 套用 → 確認正確刪除，
   多刪幾個測試沒有互相蓋掉。
3. 確認刪除後看到兩組建議清單（其他天景點 / 新候選），勾選幾項、調整停留時間、加入 →
   一次寫入、地圖座標正確（尤其重用其他天的，座標應與原本一致，不重新 geocode）。
4. 刻意加入一個跟其他天重複的景點 → 確認該天出現「重複」警告徽章，tooltip 正確。
5. 加入後手動拖曳排序 → 確認既有拖曳機制正常。
6. 拿掉 `GOOGLE_PLACES_API_KEY` 測試「新候選」→ 應該走 fallback 純文字建議，不 crash。
7. `.env.local` 設 `MOCK_AI=1`/`MOCK_AI=error` → 確認 `stop-suggestions` 走 mock fixture / 錯誤狀態。
8. 確認 `regenerate/route.ts` 刪除後沒有殘留 UI/死連結；跑 `npx tsc --noEmit` 確認型別無誤。

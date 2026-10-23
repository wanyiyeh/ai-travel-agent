# ADR-0006：每個座標附上取得時間，超過 30 天就刪除，顯示時順便重新取得

日期：2026-10-23
狀態：Accepted

## 背景

依 [ADR-0004](0004-google-maps-content-storage.md)，Google 的座標最多只能保存 30 天，到期必須刪除。座標存在好幾個地方：

- `Place` 表：已經有 `coordsFetchedAt`（#203）。
- 行程（`Itinerary.days`）裡每個景點、餐點、住宿的 `lat`/`lng`，沒有取得時間。
- 候選紀錄（`*CandidateLog`）與垃圾桶（`DeletedStop`、`DeletedDay`）：同上。

排程、交通時間、距離檢查等很多程式直接讀行程裡的座標。

## 決策

- **每個地點項目都存取得時間**：`coordsFetchedAt` 加進可儲存欄位白名單（`src/lib/placeStorage.ts`）。寫入時，有座標但沒有時間的項目視為這次請求剛取得，蓋上現在的時間；已經有時間的保留原值。
- **定期刪除過期座標**：`purgeExpiredCoords()`（`src/lib/coordsPurge.ts`）把超過 `COORDS_MAX_AGE_MS`（`src/lib/placeStorage.ts`）或沒有時間的座標刪掉，只留 place ID。涵蓋行程、候選紀錄、垃圾桶與 `Place` 表。只處理有 place ID 的項目：沒有 place ID 的座標（機場、交通）是我們自己的資料。目前用 `npm run purge-expired-coords` 手動執行；每天自動執行的排程在 #211 接上。只在 `COMPLIANT_PLACE_STORAGE=1` 時執行，因為關閉時寫入不會蓋時間。
- **顯示時重新取得**：補名稱的 Place Details 查詢（`src/lib/placeDisplay.ts`）多取 `location`。一次請求依最高等級計費，名稱已是 Pro，加座標（Essentials）不多付錢。補回的座標帶著新的取得時間；編輯路由存回行程時就一起保存。

## 考慮過的替代方案

- **行程裡不存座標，讀取時一律從 `Place` 表帶入**：只有一個地方要清，但排程、交通、驗證等直接讀行程座標的程式都要改，風險高。
- **整份行程共用一個取得時間**：簡單，但編輯其中一天會讓整份行程看起來都是新的，其他天的舊座標不會被刪，不符合條款。

## 後果

- 新增寫入地點的程式不需要自己蓋時間，但**不可以**把舊座標去掉 `coordsFetchedAt` 再寫回去，否則會被當成新的。
- 啟用 `COMPLIANT_PLACE_STORAGE` 之前留下、沒有時間的座標，第一次清除就會被刪掉（#206 啟用開關時先跑一次）。
- 超過 30 天沒打開的行程，還沒展開的那幾天沒有座標：地圖上暫時沒有圖釘，跨天的距離檢查會跳過這些地點，展開後補回（#236）。

## 相關

- [ADR-0004](0004-google-maps-content-storage.md)、[ADR-0005](0005-place-display-hybrid.md)
- PLAN-001 任務 10（#204）；排程 #211；清理與啟用開關 #206
- `src/lib/placeStorage.ts`、`src/lib/coordsPurge.ts`、`src/lib/placeDisplay.ts`、`src/lib/placeCache.ts`、`scripts/purge-expired-coords.ts`

# STATUS

更新：2026-10-23

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線，進行中（父 issue #196）。Google 合規的 A 系列已合併到 #205：寫入時移除 Google 欄位（#200）、顯示時補名稱（#201、#202，[ADR-0005](adr/0005-place-display-hybrid.md)）、候選池與路線不再快取（#203）、座標 30 天清除（#204，[ADR-0006](adr/0006-coordinate-expiry.md)）、Google Maps 標誌與 Places UI Kit 地點詳情（#205）。

#206 拆成兩個 PR：第一個（移除 `COMPLIANT_PLACE_STORAGE` 開關、寫入一律合規；稽核與清理腳本）已開，等使用者合併。第二個是刪掉 `Place` 表的舊欄位與四張內容快取表、處理依賴它們的腳本（使用者已決定：存 Google 內容的 5 支刪除，其餘改寫）。

量測結果（2026-10-23，`dev:free`）：一次生成 Google 約 US$0.24～0.41，最貴的是 Nearby Search Pro；假的 OpenAI 會讓 Text Search 少算。方法與數字見 [runbook](runbook.md)。

## 下一步

1. 使用者操作：#181（GCP 預算通知、OpenAI 硬上限）、#197（確認 OpenAI 沒有分享資料給訓練）。
2. #206 第一個 PR 合併後：在 `dev.db`、`mock.db` 先備份再跑清理（不可逆，執行前要使用者同意），然後做第二個 PR。

## 卡點與待決定

- 每日 Google 上限 US$3 只夠約 7 次生成，低於 app 的全站每日上限；在 #213 決定提高上限、降低生成上限或減少查詢（已記在 #213）。不快取之後同城市重複生成也要全額付費。
- #188（Nearby 降到 Pro）的效益變小：每次生成的 Nearby Enterprise 只剩 1～2 次。
- 開發時切到地圖模式會用真的 key 計費，連 `dev:free` 也一樣（#239）。
- 手動測試 `dev:free`：人機驗證用 `TURNSTILE_SECRET_KEY="" npm run dev:free` 略過；訪客每人 1 次、同一 IP 每天 2 次。
- Dependabot PR #170、#47 還開著。

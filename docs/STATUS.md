# STATUS

更新：2026-10-23

> 交接筆記。每次對話結束前**覆蓋**更新，只寫現況，不累加歷史。

## 現在在做什麼

[PLAN-001](plans/PLAN-001-portfolio-launch.md) 作品集上線，進行中（父 issue #196）。Google 合規的 A 系列已完成：寫入時一律移除 Google 欄位、顯示時補名稱（[ADR-0005](adr/0005-place-display-hybrid.md)）、候選池與路線只在同一請求內共用、座標 30 天清除（[ADR-0006](adr/0006-coordinate-expiry.md)）、Google Maps 標誌與 Places UI Kit 地點詳情、稽核與清理（`npm run audit-google-content`）、舊欄位與四張內容快取表已從結構移除。`dev.db`、`mock.db` 已清理並 `db push`，稽核為 0（備份在 `prisma/*.db.backup-20261023`，確定不需要可自行刪除）。

#208（SQLite → Postgres）進行中：本機改用 Docker 的 Postgres（[ADR-0007](adr/0007-local-postgres-docker.md)），`prisma migrate` 基準線已建立，整合測試在 Postgres 上全數通過，CI 已加 Postgres service。第一個 PR 已合併，使用者的 `.env` 已指向本機 Postgres。第二個 PR 是把 `dev.db`、`mock.db` 的資料搬進 `travel`、`travel_mock`（目前這兩個資料庫還是空的）。

#188（Nearby 降到 Pro）評估後不做：省約 1～2%，卻會讓午晚餐的預算篩選與餐費估算失準；改在 #242 評估減少 Nearby Search 次數。

量測結果（2026-10-23，`dev:free`）：一次生成 Google 約 US$0.24～0.41，最貴的是 Nearby Search Pro；假的 OpenAI 會讓 Text Search 少算。方法與數字見 [runbook](runbook.md)。

## 下一步

1. 使用者操作：#181（GCP 預算通知、OpenAI 硬上限）、#197（確認 OpenAI 沒有分享資料給訓練）、#207（書面詢問 Google 灰色地帶）。
2. #208 第二個 PR：搬資料腳本（執行前要使用者同意）。接著 #209（限流與熔斷改存 Postgres）。
3. 可穿插的小項目：#242（減少 Nearby 次數的評估）、#239（mock 模式的地圖不要計費）。

## 卡點與待決定

- 每日 Google 上限 US$3 只夠約 7 次生成，低於 app 的全站每日上限；在 #213 決定提高上限、降低生成上限或減少查詢（已記在 #213）。不快取之後同城市重複生成也要全額付費。
- 開發時切到地圖模式會用真的 key 計費，連 `dev:free` 也一樣（#239）；`/dev/place-details` 測試頁也用真的 key。
- 開發前要先開 Docker Desktop 並 `npm run db:up`，否則連不上資料庫。
- 手動測試 `dev:free`：人機驗證用 `TURNSTILE_SECRET_KEY="" npm run dev:free` 略過；訪客每人 1 次、同一 IP 每天 2 次。
- Dependabot PR #170、#47 還開著。
